import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import type { CheckResult, Fact, StatusCheckDef, StatusState } from "@/lib/status/types"
import {
  R2_CREDENTIAL_VARS, backupFolder, describeR2Error, fmtBytes, fmtWhen, missingSettings, probeClient,
} from "./storage"

// 💾 Last night's backup — the nightly JSON copy of the database in the R2 backup bucket.
//
// server.js calls /api/cron/db-backup at midnight UTC (then every 24 h); it writes
// `${env}/backup-YYYY-MM-DD-HHMMSS.json` and keeps the newest 30 per environment.
//
// ⚠ The FILE is the only evidence a backup happened. runBackup writes no database row, and
// the Railway log can't be trusted either: server.js does r.json() without checking r.ok,
// so a failed run logs "complete: undefined (undefined bytes)". So this check lists this
// environment's folder — exactly the call /admin/backup makes — and reads LastModified/Size.
//
// ⚠ NEVER "test" it by calling /api/cron/db-backup or POST /api/admin/backup: that writes a
// new file and can prune a real one out of the 30. And never download a backup — each is
// the whole database as JSON, many megabytes.
//
// ⚠ Freshness comes from LastModified, never the filename: the name is built with the
// server's LOCAL getHours() — UTC on Railway only because the container clock is.
//
// ⚠ A green light can't mean "every table was saved". fetchTable turns a failed table into
// null and the run still reports ok, so a backup taken on a bad database day "succeeds"
// with tables missing. Only a big drop in size shows that from outside — and a big
// legitimate delete can cause one too — hence amber, never red. A small table failing
// (users, induction signatures) barely moves the size and can't be seen at all.
//
// ⚠ The schedule is a setTimeout-to-midnight from boot with no catch-up: a crash or deploy
// across 00:00 UTC silently skips that night. That is what the 26-hour red is for.

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** The job builds the whole dump in memory before uploading, so give it until 01:00 UTC
 *  before expecting tonight's file; until then last night's still counts. */
const GRACE_UTC_HOUR = 1
const DOWN_AFTER_MS = 26 * HOUR_MS
/** Amber below this share of the usual size. */
const SMALL_RATIO = 0.7
/** "Usual size" = the middle of up to this many full copies before the newest. */
const SIZE_SAMPLE = 7
/** Mirrors MAX_BACKUPS in app/api/cron/db-backup/route.ts. */
const KEEP = 30
const CALL_TIMEOUT_MS = 10_000
const BUDGET_MS = 20_000
/** The folder holds ~30 files, one page; this only guards against a runaway listing. */
const MAX_PAGES = 5

interface BackupFile { key: string; size: number; at: number; partial: boolean }

async function listBackups(bucket: string, prefix: string): Promise<{ files: BackupFile[]; ms: number }> {
  const deadline = Date.now() + BUDGET_MS
  const files: BackupFile[] = []
  let token: string | undefined
  let ms = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const started = Date.now()
    const timeout = Math.max(1_000, Math.min(CALL_TIMEOUT_MS, deadline - Date.now()))
    const res = await probeClient().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      { abortSignal: AbortSignal.timeout(timeout) },
    )
    if (page === 0) ms = Date.now() - started
    for (const o of res.Contents ?? []) {
      // Same filter as /api/admin/backup: .json files, "-partial" in the name = a manual
      // backup of only some sections.
      if (!o.Key?.endsWith(".json") || !o.LastModified) continue
      files.push({ key: o.Key, size: o.Size ?? 0, at: o.LastModified.getTime(), partial: o.Key.includes("-partial") })
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break
    token = res.NextContinuationToken
  }
  return { files, ms }
}

// ── Wording ───────────────────────────────────────────────────────────────────────────

const londonYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })
const londonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })

/** "today at 01:00", "yesterday at 01:00", "on Tue 8 Sept at 01:00" — London time. */
function whenSaid(ms: number, nowMs: number): string {
  const day = londonYmd.format(ms)
  const time = londonTime.format(ms)
  if (day === londonYmd.format(nowMs)) return `today at ${time}`
  if (day === londonYmd.format(nowMs - DAY_MS)) return `yesterday at ${time}`
  return `on ${londonDate.format(ms)} at ${time}`
}

function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const SCHEDULE_FACT: Fact = { label: "When it runs", value: "Every night at midnight UTC (1 am UK time in summer)" }
const PROVES_FACT: Fact = {
  label: "What green proves",
  value: "A full copy arrived since midnight and is about its usual size. A small table failing to copy wouldn't show — the job saves it empty without an error.",
}
const NOT_COVERED_FACT: Fact = {
  label: "Not in the backup",
  value: "Photos and files, the ABC and BC Databases, the BC warehouse copy, First Aid and the lot change log. Neon's own restore covers the whole database.",
}

/** The facts that describe what's in the folder, used whether or not backups run here. */
function folderFacts(files: BackupFile[], nowMs: number, newestTone?: Fact["tone"]): Fact[] {
  const full = files.filter(f => !f.partial).sort((a, b) => b.at - a.at)
  const partial = files.filter(f => f.partial).sort((a, b) => b.at - a.at)
  const facts: Fact[] = [{
    label: "Newest full copy",
    value: full[0] ? `${fmtWhen(full[0].at, nowMs)} · ${fmtBytes(full[0].size)}` : "None in this environment's folder",
    ...(newestTone ? { tone: newestTone } : {}),
  }]
  const before = full.slice(1, 1 + SIZE_SAMPLE)
  if (before.length) {
    facts.push({
      label: "Usual size",
      value: `About ${fmtBytes(median(before.map(f => f.size)))} (the middle of the ${before.length} full cop${before.length === 1 ? "y" : "ies"} before it)`,
    })
  }
  if (partial[0]) {
    const newer = !full[0] || partial[0].at > full[0].at
    facts.push({
      label: "Newest partial copy",
      value: `${fmtWhen(partial[0].at, nowMs)} · ${fmtBytes(partial[0].size)} — only some sections${newer ? ", so it doesn't count as a full backup" : ""}`,
    })
  }
  facts.push({
    label: "Copies kept",
    value: `${files.length} of ${KEEP} (${full.length} full, ${partial.length} partial)`,
    // ⚠ Partial copies count towards the 30 the job keeps, so a burst of them pushes real
    // nightly copies out early (the prune sorts by name, not by kind).
    ...(partial.length >= 5 ? { tone: "warn" as const } : {}),
  })
  if (partial.length >= 5) {
    facts.push({ label: "Partial copies", value: "They count towards the 30 kept, so they push full nightly copies out sooner.", tone: "warn" })
  }
  return facts
}

const backup: StatusCheckDef = {
  key: "backup",
  name: "Last night's backup",
  group: "hub",
  what: "The nightly copy of the database kept in R2 (the last 30).",
  whenDown: "If data were lost, the newest in-app copy would be older than it should be.",
  intervalMin: 60,

  async run(ctx): Promise<CheckResult> {
    const nowMs = ctx.now.getTime()
    const folder = backupFolder()
    const folderFact: Fact = { label: "Folder", value: `${folder} in the backup store` }
    const missing = missingSettings([...R2_CREDENTIAL_VARS, "CLOUDFLARE_R2_BACKUP_BUCKET"])
    const bucket = process.env.CLOUDFLARE_R2_BACKUP_BUCKET?.trim() ?? ""

    // ⚠ FIRST: backups only run where server.js runs its background jobs (production build +
    // CRON_SECRET). Sandbox has no CRON_SECRET by design — never add one — and its folder
    // stays empty unless someone presses Run backup there. Grey, never red.
    if (!ctx.backgroundJobsExpected) {
      const facts: Fact[] = [{
        label: "Why it's off",
        value: "The nightly backup runs only where the Hub's background jobs do. Anything here was made by pressing Run backup on Admin → Backup.",
      }]
      if (missing.length) {
        facts.push({ label: "Backup store", value: "Not set up on this environment" })
      } else {
        try {
          const { files } = await listBackups(bucket, folder)
          facts.push(...folderFacts(files, nowMs))
        } catch (e) {
          const f = describeR2Error(e, CALL_TIMEOUT_MS)
          facts.push({ label: "Backup list", value: `Couldn't be read — Cloudflare storage ${f.text}`, tone: "warn" })
        }
      }
      facts.push(folderFact)
      return { state: "off", summary: "Backups don't run on this environment.", facts }
    }

    // Jobs run here, but the job has nowhere to write: every night's run throws.
    if (missing.length) {
      return {
        state: "down",
        summary: "No backups can be made here because the backup store isn't set up on this environment.",
        facts: [{ label: "Missing settings", value: missing.join(", "), tone: "bad" }, SCHEDULE_FACT],
      }
    }

    let files: BackupFile[]
    let latencyMs: number
    try {
      ;({ files, ms: latencyMs } = await listBackups(bucket, folder))
    } catch (e) {
      const f = describeR2Error(e, CALL_TIMEOUT_MS)
      return {
        state: f.state,
        summary: `Couldn't read the list of backups: Cloudflare storage ${f.text}.`,
        facts: [{ label: "Backup list", value: `Failed — ${f.detail}`, tone: f.state === "unknown" ? "warn" : "bad" }, folderFact, SCHEDULE_FACT],
      }
    }

    const full = files.filter(f => !f.partial).sort((a, b) => b.at - a.at)
    const partial = files.filter(f => f.partial).sort((a, b) => b.at - a.at)
    const newest = full[0]

    // Before 01:00 UTC, last night means the night before.
    const todayUtc = Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), ctx.now.getUTCDate())
    const cutoff = ctx.now.getUTCHours() < GRACE_UTC_HOUR ? todayUtc - DAY_MS : todayUtc

    let state: StatusState
    let summary: string
    let tone: Fact["tone"]
    const extra: Fact[] = []

    // ⚠ Judged on the newest FULL copy only. A partial one is someone pressing Run backup
    // for a few sections: it doesn't make up for a missed night, and one taken after a good
    // nightly copy is not a problem (judgement call — the spec's "newest is partial" read
    // literally would turn the light amber every time an admin took a quick partial copy).
    if (!newest) {
      state = "down"; tone = "bad"
      summary = "There's no full backup for this environment in the backup store."
    } else if (nowMs - newest.at > DOWN_AFTER_MS) {
      state = "down"; tone = "bad"
      summary = `No full backup has been saved for ${Math.floor((nowMs - newest.at) / HOUR_MS)} hours — the newest was ${whenSaid(newest.at, nowMs)}.`
    } else if (newest.at < cutoff) {
      state = "degraded"; tone = "warn"
      summary = `Last night's backup hasn't arrived yet — the newest full copy was saved ${whenSaid(newest.at, nowMs)}.`
    } else {
      const before = full.slice(1, 1 + SIZE_SAMPLE).map(f => f.size)
      const usual = before.length ? median(before) : 0
      if (usual > 0 && newest.size < SMALL_RATIO * usual) {
        state = "degraded"; tone = "warn"
        summary = `The newest backup was saved ${whenSaid(newest.at, nowMs)} but is much smaller than usual (${fmtBytes(newest.size)} against about ${fmtBytes(usual)}), so some tables may be missing from it.`
      } else {
        state = "ok"; tone = "good"
        summary = `The newest full backup was saved ${whenSaid(newest.at, nowMs)} (${fmtBytes(newest.size)}).`
        if (!before.length) extra.push({ label: "Size check", value: "Not done — there's no earlier full copy to compare with" })
      }
    }

    if (state !== "ok" && partial[0] && (!newest || partial[0].at > newest.at)) {
      extra.push({ label: "Since then", value: `Only a partial copy (some sections) was saved, ${whenSaid(partial[0].at, nowMs)} — it doesn't count as a full backup.`, tone: "warn" })
    }

    return {
      state,
      summary,
      facts: [...folderFacts(files, nowMs, tone), ...extra, SCHEDULE_FACT, folderFact, PROVES_FACT, NOT_COVERED_FACT],
      latencyMs,
    }
  },
}

export default backup
