import { prisma } from "@/lib/prisma"
import type { CheckResult, Fact, StatusCheckDef } from "@/lib/status/types"

// ✉ IT emails → Job Board — the Outlook → Power Automate → Make.com relay.
//
// An Outlook rule on IT@ redirects each email, Jordan's Power Automate flow re-sends
// it to a Make.com mail hook, and Make's scenario POSTs it to /api/it-mailbox/inbound,
// which turns it into a new job or a reply on an existing one.
//
// ⚠ Nothing in that chain can be pinged without a side effect. Sending a test email,
// or POSTing to the webhook with the real key, makes a real job on the board. A POST
// with a WRONG key only proves our own route answers, which tells us nothing. So this
// light is PASSIVE: when did the chain last deliver something the Hub saved?
//
// ⚠ Only two kinds of row prove a relayed email arrived (mail research, reviewer's version):
//   · ITJob where source = EMAIL AND threadKey IS NOT NULL. Only the webhook sets threadKey
//     (inbound/route.ts, normaliseSubject always returns a string). The Job Board's
//     🧪 Test buttons (createTestITJob) and the dormant Graph poll both leave it null.
//   · ITJobMessage where kind = REPLY. The inbound route is its only writer.
// ⚠ NOT ITJobAttachment. The 🧪 Test buttons write 2–3 attachment rows every press, so
// counting attachments would let someone testing the board turn this green while Make
// is switched off. Nothing is lost by leaving them out: every relayed email produces a
// job or a reply, because Make's text module always runs.
//
// ⚠ Production only. Make posts to the production Hub. The staging and sandbox databases
// are copies of production and hold whatever emails existed the day they were copied,
// so there they would show a frozen "last email" and a false amber.
//
// ⚠ Never red on silence. Quiet nights, weekends and bank holidays are normal, and
// silence cannot tell "nobody emailed IT" from "Make switched itself off". Amber after
// about two working days is the most this signal can honestly say.
//
// ⚠ Green does NOT prove every email arrived. On 2026-09-09, with ~1 in 4 saves refused,
// some deliveries would have got a 500 and been dropped by Make while others landed and
// kept this green. Refused deliveries leave no row here; only Make's own history shows them.

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** About two working days without an email before it goes amber. */
const QUIET_WORKING_MS = 2 * DAY_MS

// ── Working time in London ───────────────────────────────────────────────────────

const londonDayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
})

const londonWhenFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
})

function londonDay(ms: number): { ymd: string; weekday: string } {
  const p: Record<string, string> = {}
  for (const part of londonDayFmt.formatToParts(new Date(ms))) p[part.type] = part.value
  return { ymd: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday }
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10)
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS)
const isWeekendUtc = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6

/** Easter Sunday (anonymous Gregorian algorithm), as a UTC midnight. */
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, (n % 31) + 1))
}

const holidayCache = new Map<number, Set<string>>()

/** England & Wales bank holidays for a year, as YYYY-MM-DD. Worked out rather than listed,
 *  so it never goes stale. One-off holidays (a coronation, a jubilee) aren't included,
 *  which is why the threshold says "about". */
function bankHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const on = (month: number, day: number) => new Date(Date.UTC(year, month - 1, day))
  const firstMonday = (month: number) => { let x = on(month, 1); while (x.getUTCDay() !== 1) x = plusDays(x, 1); return x }
  const lastMonday = (month: number) => { let x = new Date(Date.UTC(year, month, 0)); while (x.getUTCDay() !== 1) x = plusDays(x, -1); return x }

  const easter = easterSunday(year)
  const set = new Set<string>([
    plusDays(easter, -2), plusDays(easter, 1),         // Good Friday, Easter Monday
    firstMonday(5), lastMonday(5), lastMonday(8),     // early May, spring, summer
  ].map(ymdOf))
  // New Year, Christmas and Boxing Day: one that falls on a weekend moves to the next
  // weekday that isn't already a holiday (so Christmas on a Saturday gives Mon 27 + Tue 28).
  const fixed = [on(1, 1), on(12, 25), on(12, 26)]
  for (const day of fixed) if (!isWeekendUtc(day)) set.add(ymdOf(day))
  for (const day of fixed) {
    if (!isWeekendUtc(day)) continue
    let x = plusDays(day, 1)
    while (isWeekendUtc(x) || set.has(ymdOf(x))) x = plusDays(x, 1)
    set.add(ymdOf(x))
  }
  holidayCache.set(year, set)
  return set
}

function isWorkingDay(ms: number): boolean {
  const { ymd, weekday } = londonDay(ms)
  if (weekday === "Sat" || weekday === "Sun") return false
  return !bankHolidays(Number(ymd.slice(0, 4))).has(ymd)
}

/** Weekday time between two instants, an hour at a time (London dates, so the clock
 *  changes look after themselves). Stops once past `cap`: we only need to know whether
 *  the quiet spell is longer than that, and a months-long gap shouldn't loop for ever. */
function workingMsBetween(fromMs: number, toMs: number, cap: number): number {
  let total = 0
  for (let t = fromMs; t < toMs && total <= cap;) {
    const next = Math.min(t + HOUR_MS, toMs)
    if (isWorkingDay(t)) total += next - t
    t = next
  }
  return total
}

// ── Wording ───────────────────────────────────────────────────────────────────────

function agoText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return "less than a minute ago"
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`
  const d = Math.floor(h / 24)
  return `${d} days ago`
}

const when = (d: Date | null) => (d ? londonWhenFmt.format(d) : "None yet")

/** Prisma errors open with several lines of "Invalid `prisma.x()` invocation"; the reason is the last line. */
function reason(e: unknown): string {
  const lines = String((e as Error)?.message ?? e).split("\n").map(l => l.trim()).filter(Boolean)
  return (lines[lines.length - 1] ?? "Unknown error").slice(0, 200)
}

const later = (a: Date | null, b: Date | null): Date | null => (!a ? b : !b ? a : a > b ? a : b)

const ROUTE_FACT: Fact = { label: "The route", value: "Outlook rule on IT@ → Power Automate → Make.com → the Hub" }
const BLIND_SPOT_FACT: Fact = {
  label: "What this can't see",
  value: "An email Make.com never sent, or one the Hub turned away, leaves no trace here. Make.com's own history shows those.",
}

const itEmail: StatusCheckDef = {
  key: "it-email",
  name: "IT emails → Job Board",
  group: "email",
  what: "Emails to IT@ reach the Job Board through Outlook → Power Automate → Make.com.",
  whenDown: "New IT emails don't appear on the Job Board.",
  statusPage: "https://status.make.com",
  intervalMin: 15,

  async run(ctx): Promise<CheckResult> {
    if (!ctx.isProduction) {
      return {
        state: "off",
        summary: "IT emails are delivered to the production Hub only, so there is nothing to check here.",
        facts: [
          { label: "This environment", value: ctx.env },
          { label: "Why it's off", value: "Make.com sends IT emails to production. This database is a copy, so its newest email is only as new as the copy." },
        ],
      }
    }

    // ⚠ Same test as the inbound route (`!secret`), so this agrees with what it will actually do.
    // Only whether it is set is ever shown — never the key, nor the keyed URL the Job Board shows admins.
    const keySet = !!process.env.IT_INBOUND_SECRET
    const keyFact: Fact = keySet
      ? { label: "Delivery key (IT_INBOUND_SECRET)", value: "Set", tone: "good" }
      : { label: "Delivery key (IT_INBOUND_SECRET)", value: "Not set — every delivery from Make.com is turned away", tone: "bad" }

    let lastJob: Date | null
    let lastReply: Date | null
    try {
      // Aggregates return one date each and read no tokens or email bodies.
      const [job, reply] = await Promise.all([
        prisma.iTJob.aggregate({ where: { source: "EMAIL", threadKey: { not: null } }, _max: { createdAt: true } }),
        prisma.iTJobMessage.aggregate({ where: { kind: "REPLY" }, _max: { createdAt: true } }),
      ])
      lastJob = job._max.createdAt
      lastReply = reply._max.createdAt
    } catch (e) {
      return {
        state: "unknown",
        summary: "Couldn't read the Job Board to see when the last IT email arrived.",
        facts: [{ label: "Reason", value: reason(e) }, keyFact],
      }
    }

    const now = ctx.now.getTime()
    const last = later(lastJob, lastReply)
    const detailFacts: Fact[] = [
      { label: "Newest job made from an email", value: when(lastJob) },
      { label: "Newest reply added to a job", value: when(lastReply) },
      keyFact,
      { label: "Goes amber after", value: "About 2 working days without an email (weekends and bank holidays don't count)" },
      { label: "Not counted", value: "Jobs made by the Job Board's 🧪 Test buttons" },
      ROUTE_FACT,
      BLIND_SPOT_FACT,
    ]

    // ⚠ A missing key is not silence — it is a certain failure: the route answers 401 to
    // every delivery, and Make switches a scenario off after repeated errors (it has done
    // so before). So this one is red, unlike the quiet-spell amber below.
    // cause "hub": it is OUR variable on OUR server — Make.com is doing nothing wrong.
    if (!keySet) {
      return {
        state: "down",
        cause: "hub",
        summary: "The key Make.com uses to deliver IT emails isn't set on this server, so every IT email is being turned away.",
        facts: [
          { label: "Last IT email on the board", value: last ? `${when(last)} (${agoText(now - last.getTime())})` : "None yet", tone: "bad" },
          ...detailFacts,
        ],
      }
    }

    // ⚠ No cause on the two ambers below, on purpose: silence can't say which link broke —
    // the Outlook rule, Power Automate, or Make.com switching the scenario off — so it is
    // left as a supplier's problem rather than guessed at.
    if (!last) {
      return {
        state: "degraded",
        summary: "No IT email has ever reached the Job Board through Make.com — worth checking the Make.com scenario is switched on.",
        facts: [{ label: "Last IT email on the board", value: "None yet", tone: "warn" }, ...detailFacts],
      }
    }

    const quietMs = now - last.getTime()
    const quiet = workingMsBetween(last.getTime(), now, QUIET_WORKING_MS) > QUIET_WORKING_MS
    if (quiet) {
      const days = Math.max(1, Math.floor(quietMs / DAY_MS))
      return {
        state: "degraded",
        summary: `No IT email has arrived for ${days} day${days === 1 ? "" : "s"} — worth checking the Make.com scenario is switched on.`,
        facts: [{ label: "Last IT email on the board", value: `${when(last)} (${agoText(quietMs)})`, tone: "warn" }, ...detailFacts],
      }
    }

    return {
      state: "ok",
      summary: `The last IT email reached the Job Board ${agoText(quietMs)}.`,
      facts: [{ label: "Last IT email on the board", value: `${when(last)} (${agoText(quietMs)})`, tone: "good" }, ...detailFacts],
    }
  },
}

export default itEmail
