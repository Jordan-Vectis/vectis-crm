import type { ReactNode } from "react"
import type { AnswerSnapshot, FeedbackQuestion, SurveyStatus } from "@/lib/feedback-types"

// 📝 Hub feedback — admin-side pieces shared by the two pages, their client components and the
// CSV export route. No hooks and no server imports, so it is safe on either side.
//
// ⚠ People's "fill it out later" drafts never reach this file's output: buildPeople() returns
// NO answers for a LATER response. What somebody has typed but not sent is theirs until they
// press Submit — the popup tells them their name goes with their ANSWERS, and a half-written
// draft isn't one yet. Enforced here, on the server's side of the page, rather than by the
// screen choosing not to show it.

// ── Words and colours (RULES.md design rule 3: every colour has a key) ───────────────

export const SURVEY_STATUS_ORDER: SurveyStatus[] = ["DRAFT", "OPEN", "CLOSED"]

export const SURVEY_STATUS_META: Record<SurveyStatus, { word: string; meaning: string; badge: string }> = {
  DRAFT: {
    word: "Draft",
    meaning: "still being written — nobody can see it yet",
    badge: "bg-sky-100 text-sky-800 ring-sky-600/30 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30",
  },
  OPEN: {
    word: "Sent out",
    meaning: "popping up for the people it was sent to",
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
  },
  CLOSED: {
    word: "Closed",
    meaning: "finished — no more popups; every answer is kept",
    badge: "bg-gray-100 text-gray-700 ring-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-400/30",
  },
}

/** Where one person is with one survey. NONE = no response row at all. */
export type PersonStatus = "SUBMITTED" | "LATER" | "NONE"

export const PERSON_STATUS_ORDER: PersonStatus[] = ["SUBMITTED", "LATER", "NONE"]

export const PERSON_STATUS_META: Record<PersonStatus, { word: string; meaning: string; badge: string }> = {
  SUBMITTED: {
    word: "Answered",
    meaning: "filled it in and pressed Submit",
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
  },
  LATER: {
    word: "Said later",
    meaning: "pressed \"Fill it out later\" — a button in their top bar brings it back",
    badge: "bg-amber-100 text-amber-900 ring-amber-600/30 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30",
  },
  NONE: {
    word: "Not answered yet",
    meaning: "hasn't seen it or done anything with it yet",
    badge: "bg-gray-100 text-gray-700 ring-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-400/30",
  },
}

export function safeSurveyStatus(s: unknown): SurveyStatus {
  return s === "OPEN" || s === "CLOSED" ? s : "DRAFT"
}

export function SurveyStatusBadge({ status, className = "" }: { status: SurveyStatus; className?: string }) {
  const m = SURVEY_STATUS_META[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${m.badge} ${className}`}>
      {m.word}
    </span>
  )
}

export function PersonStatusBadge({ status }: { status: PersonStatus }) {
  const m = PERSON_STATUS_META[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${m.badge}`}>
      {m.word}
    </span>
  )
}

/** The key for a set of badges — the badge itself, then what it means. */
export function BadgeKey({ items }: { items: { badge: string; word: string; meaning: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600 dark:text-gray-400">
      {items.map(i => (
        <span key={i.word} className="inline-flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset whitespace-nowrap ${i.badge}`}>{i.word}</span>
          <span>{i.meaning}</span>
        </span>
      ))}
    </div>
  )
}

/** A tick box drawn by us, not the browser: a native checkbox is ~16px (too small for a finger on
 *  the iPads — design rule 5) and takes the BROWSER's colours on the dark theme (rule 2). The whole
 *  row is the button, at least 44px tall. */
export function TickBox({ ticked, onToggle, disabled, children, className = "" }: {
  ticked: boolean
  onToggle: () => void
  disabled?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ticked}
      disabled={disabled}
      onClick={onToggle}
      className={`flex w-full min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors disabled:opacity-50 ${
        ticked
          ? "bg-emerald-50 ring-1 ring-emerald-500/60 dark:bg-emerald-500/10 dark:ring-emerald-400/50"
          : "hover:bg-gray-100 dark:hover:bg-gray-800/70"
      } ${className}`}
    >
      <span
        aria-hidden
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold ${
          ticked ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-gray-950" : "border-gray-400 dark:border-gray-500"
        }`}
      >
        {ticked ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
}

// ── Times, always Europe/London (Railway runs UTC) ───────────────────────────────

const F_DATETIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
})
const F_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" })
const F_ISO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })

export function londonDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? "—" : F_DATETIME.format(d)
}

export function londonDate(v: string | Date | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? "—" : F_DATE.format(d)
}

/** YYYY-MM-DD in London — for file names. */
export function londonIsoDay(v: Date = new Date()): string {
  return F_ISO_DAY.format(v)
}

// ── Roles and audience ─────────────────────────────────────────────────────────

/** "CATALOGUER" → "Cataloguer"; a custom role someone typed in mixed case is left as they wrote it. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—"
  if (role !== role.toUpperCase()) return role
  return role.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

/** The role a survey's audience is judged on. ⚠ The popup side (app/api/feedback/mine and
 *  /respond) treats it@vectis.co.uk as ADMIN whatever the User table says — the same superadmin
 *  rule auth.ts applies at sign-in. The admin screens must count him the same way, or a survey
 *  ticked "Admin" says "N people" while reaching N+1, and his answers show as "no longer in the
 *  audience". Every user list on these screens goes through this before it is counted. */
export function feedbackRole(u: { email?: string | null; role: string }): string {
  return (u.email ?? "").toLowerCase() === "it@vectis.co.uk" ? "ADMIN" : String(u.role)
}

/** Is this person in the audience? ⚠ The SAME rule as inAudience() in lib/feedback.ts — which
 *  can't be imported here because it pulls in the database client. Change one, change both, or
 *  the "N people will get this" count stops matching who actually gets the popup. The role must
 *  already have been through feedbackRole(). */
export function audienceIncludes(a: { audienceRoles: string[]; audienceUserIds: string[] }, u: { id: string; role: string }): boolean {
  return a.audienceRoles.includes(u.role) || a.audienceUserIds.includes(u.id)
}

// ── People and their answers ───────────────────────────────────────────────────

export type PersonRow = {
  userId: string
  name: string
  /** Their CURRENT role; null when the account has since been deleted. */
  role: string | null
  /** Still in the survey's audience. False for someone who answered and was later unticked. */
  inAudience: boolean
  status: PersonStatus
  /** ISO. Only for SUBMITTED. */
  submittedAt: string | null
  /** Submitted answers only — always empty for LATER (see the note at the top). */
  answers: AnswerSnapshot[]
}

export type ResponseInput = {
  userId: string
  userName: string | null
  status: string
  answers: AnswerSnapshot[]
  submittedAt: Date | string | null
}

/** Everyone in the audience, plus anyone who has answered or put it off without being in it any
 *  more (their answers still count as answers). Sorted by name. */
export function buildPeople(input: {
  audience: { audienceRoles: string[]; audienceUserIds: string[] }
  users: { id: string; name: string; role: string }[]
  responses: ResponseInput[]
}): PersonRow[] {
  const byUser = new Map(input.responses.map(r => [r.userId, r]))
  const usersById = new Map(input.users.map(u => [u.id, u]))
  const out: PersonRow[] = []
  const seen = new Set<string>()

  const row = (userId: string, name: string, role: string | null, inAud: boolean): PersonRow => {
    const r = byUser.get(userId)
    const status: PersonStatus = r?.status === "SUBMITTED" ? "SUBMITTED" : r?.status === "LATER" ? "LATER" : "NONE"
    return {
      userId,
      name: name || r?.userName || "(no name)",
      role,
      inAudience: inAud,
      status,
      submittedAt: status === "SUBMITTED" && r?.submittedAt ? new Date(r.submittedAt).toISOString() : null,
      answers: status === "SUBMITTED" ? r!.answers : [],
    }
  }

  for (const u of input.users) {
    if (!audienceIncludes(input.audience, u)) continue
    out.push(row(u.id, u.name, u.role, true))
    seen.add(u.id)
  }
  for (const r of input.responses) {
    if (seen.has(r.userId)) continue
    const u = usersById.get(r.userId)
    out.push(row(r.userId, u?.name ?? r.userName ?? "(deleted account)", u?.role ?? null, false))
    seen.add(r.userId)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }))
}

export type SurveyCounts = {
  /** People in the audience right now. */
  audience: number
  answered: number
  later: number
  notYet: number
  /** Answered, but no longer in the audience — counted separately so "N of M" never exceeds M. */
  answeredOutside: number
}

export function countPeople(people: PersonRow[]): SurveyCounts {
  const inAud = people.filter(p => p.inAudience)
  return {
    audience: inAud.length,
    answered: inAud.filter(p => p.status === "SUBMITTED").length,
    later: inAud.filter(p => p.status === "LATER").length,
    notYet: inAud.filter(p => p.status === "NONE").length,
    answeredOutside: people.filter(p => !p.inAudience && p.status === "SUBMITTED").length,
  }
}

export type QuestionColumn = {
  id: string
  /** The wording most answers were given to (their stored snapshot) — falls back to today's wording. */
  heading: string
  /** Today's wording; null when the question has since been removed from the survey. */
  currentText: string | null
  removed: boolean
}

/** One column per question: the survey's current questions in order, then any that were removed
 *  after people had answered them (their answers are still on record). */
export function buildColumns(current: FeedbackQuestion[], people: PersonRow[]): QuestionColumn[] {
  const wordings = new Map<string, Map<string, number>>()
  const firstSeen: string[] = []
  for (const p of people) {
    for (const a of p.answers) {
      if (!a.questionId) continue
      if (!wordings.has(a.questionId)) { wordings.set(a.questionId, new Map()); firstSeen.push(a.questionId) }
      const m = wordings.get(a.questionId)!
      const w = a.question.trim()
      if (w) m.set(w, (m.get(w) ?? 0) + 1)
    }
  }
  const mostCommon = (id: string): string | null => {
    const m = wordings.get(id)
    if (!m || m.size === 0) return null
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
  const cols: QuestionColumn[] = current.map(q => ({ id: q.id, heading: mostCommon(q.id) ?? q.text, currentText: q.text, removed: false }))
  const currentIds = new Set(current.map(q => q.id))
  for (const id of firstSeen) {
    if (currentIds.has(id)) continue
    cols.push({ id, heading: mostCommon(id) ?? "(question removed)", currentText: null, removed: true })
  }
  return cols
}

export function answerFor(p: PersonRow, questionId: string): AnswerSnapshot | undefined {
  return p.answers.find(a => a.questionId === questionId)
}
