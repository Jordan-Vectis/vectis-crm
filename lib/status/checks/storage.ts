import { S3Client, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma"
import type { CheckResult, Fact, StatusCheckDef, StatusState } from "@/lib/status/types"

// 🗄 Photo & file storage — Cloudflare R2.
//
// Every lot photo, document, invoice, screen recording, screenshot and archive photo copy
// lives in the main bucket (CLOUDFLARE_R2_BUCKET); the nightly database copies live in a
// second bucket (CLOUDFLARE_R2_BACKUP_BUCKET). ⚠ R2 holds the ONLY copy of the files: the
// nightly backup copies database rows, never the files themselves.
//
// What green proves: a HEAD on a file we know exists came back 200 — the account address
// answers, the Hub's key is accepted and the bucket can be read. Plus a list of this
// environment's folder in the backup bucket answered.
//
// ⚠ It does NOT prove uploads work. A key can read without being allowed to write — the same
// shape as 2026-09-09, when the database answered every read while ~1 in 4 saves failed. A
// real upload test means writing a probe file, which the Status Centre never does (and on
// staging/sandbox it would land in the SHARED production bucket). So uploads are shown
// passively instead: the newest saves on record, as facts, never as the light.
//
// ⚠ Never reuse objectExistsInR2() (lib/r2.ts). It answers false on EVERY error, so an outage
// would read as "file not there" — the recorder review caught exactly that telling people
// their upload was lost when it wasn't (RULES "Only a definite 404 means nothing was saved").
//
// ⚠ A HEAD 404 has no body, so a missing FILE can't be told apart from a missing BUCKET.
// Hence: the reference file is write-once (ArchiveLot / BcLotWeb photoKey — no code path
// deletes archive-photos/ or bc-photos/ keys), a 404 is confirmed on a second file from a
// different table, and only then is the bucket itself asked (a LIST 404 does carry a body,
// NoSuchBucket). Lot photos are only a last resort: cataloguers delete them every day, so
// one going missing is normal and never turns the light amber.

const CALL_TIMEOUT_MS = 10_000
const PICK_TIMEOUT_MS = 6_000
/** Everything this check does must finish inside the engine's 25 s cap. */
const BUDGET_MS = 22_000
const UPLOAD_FACTS_TIMEOUT_MS = 5_000
/** After finding no reference file at all, don't scan the tables again for this long.
 *  (ArchiveLot has ~950k rows and no index on photoKey — an environment without photo copies
 *  would otherwise be scanned end to end every 5 minutes.) */
const NONE_RETRY_MS = 60 * 60 * 1000

// ── Shared with ./backup ─────────────────────────────────────────────────────────────

export const R2_CREDENTIAL_VARS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY"] as const

/** Names (never values) of the settings that are missing or blank. */
export function missingSettings(names: readonly string[]): string[] {
  return names.filter(n => !process.env[n]?.trim())
}

/** This environment's folder in the backup bucket — worked out EXACTLY as the backup job
 *  (app/api/cron/db-backup/route.ts) and /api/admin/backup do, `?? "unknown"` included,
 *  so the check looks where the files actually go. */
export function backupFolder(): string {
  return `${process.env.RAILWAY_ENVIRONMENT_NAME ?? "unknown"}/`
}

/** A client for probes only — same address and key as lib/r2.ts, but ONE attempt per call.
 *  ⚠ The shared client has no timeout and the SDK retries up to 3 times by default: a hung
 *  call would hang the check, and retries would hide flakiness and inflate the timing. The
 *  engine already waits for 2 bad checks in a row before the bell rings, so one request per
 *  check is the honest measure. Kept on globalThis like the engine's own state. */
export function probeClient(): S3Client {
  const g = globalThis as unknown as { _statusR2Probe?: S3Client }
  return (g._statusR2Probe ??= new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? "",
    },
    maxAttempts: 1,
  }))
}

export type R2FailKind =
  | "refused" | "no-bucket" | "not-found" | "rate-limited" | "server-error"
  | "timeout" | "dns" | "network" | "unexpected"

export interface R2Failure {
  kind: R2FailKind
  state: StatusState
  /** Finishes a sentence that starts "Cloudflare storage …" — plain English, no key or address. */
  text: string
  /** Short machine detail for a fact: "403 AccessDenied", "TimeoutError (ETIMEDOUT)". */
  detail: string
}

/** Answers that can only mean the key itself is wrong. ⚠ R2 answers a malformed or unknown
 *  key with a 400, not a 403 — without this list a mistyped key would read grey, never red. */
const BAD_KEY_NAMES = new Set([
  "InvalidAccessKeyId", "SignatureDoesNotMatch", "AuthorizationHeaderMalformed", "InvalidToken", "ExpiredToken",
])
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"])
const CUT_OFF_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"])
const CONNECT_CODES = new Set([
  "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EADDRNOTAVAIL",
  "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
])

/** Sorts an R2 error into what it means for the Hub. Reads only the error's name, code and
 *  HTTP status — never its message, which can quote the request. */
export function describeR2Error(e: unknown, timeoutMs: number): R2Failure {
  const err = (e ?? {}) as { name?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number }; cause?: { code?: unknown } }
  const status = err.$metadata?.httpStatusCode
  const name = typeof err.name === "string" && err.name ? err.name : "Error"
  const code = typeof err.code === "string" ? err.code : typeof err.cause?.code === "string" ? err.cause.code : undefined
  const detail = typeof status === "number" ? `${status} ${name}` : code ? `${name} (${code})` : name

  if (typeof status === "number") {
    if (status === 401 || status === 403 || (status >= 400 && status < 500 && BAD_KEY_NAMES.has(name))) {
      // ⚠ A 403 can also be the clock, not the key — say which when the answer tells us
      // (only LIST answers carry the reason; a HEAD 403 has no body).
      if (name === "RequestTimeTooSkewed") return { kind: "refused", state: "down", text: "refused the Hub's requests because this server's clock is wrong", detail }
      return { kind: "refused", state: "down", text: "refused the Hub's key", detail }
    }
    if (status === 404) {
      return name === "NoSuchBucket"
        ? { kind: "no-bucket", state: "down", text: "says the bucket named in the Hub's settings doesn't exist", detail }
        : { kind: "not-found", state: "down", text: "has no file under that name", detail }
    }
    // Rate limiting is "working, but turning some requests away" — amber, never red.
    // (S3's own word for it, SlowDown, arrives as a 503, so it is checked before the 5xx rule.)
    if (status === 429 || name === "SlowDown") return { kind: "rate-limited", state: "degraded", text: "is turning requests away for now (too many requests)", detail }
    if (status >= 500) return { kind: "server-error", state: "down", text: `is answering with an error (${status})`, detail }
    return { kind: "unexpected", state: "unknown", text: `gave an answer the check didn't expect (${detail})`, detail }
  }

  // ⚠ Check the code BEFORE the name: the SDK renames a reset connection "TimeoutError"
  // (@smithy/node-http-handler), and "didn't answer in time" would be the wrong story.
  if (code && DNS_CODES.has(code)) return { kind: "dns", state: "down", text: "couldn't be found on the network (a DNS failure, or the account setting is wrong)", detail }
  if (code && CUT_OFF_CODES.has(code)) return { kind: "network", state: "down", text: "cut the connection off before answering", detail }
  if (code && CONNECT_CODES.has(code)) return { kind: "network", state: "down", text: "couldn't be connected to", detail }
  if (name === "AbortError" || name === "TimeoutError" || code === "ETIMEDOUT") {
    return { kind: "timeout", state: "down", text: `didn't answer within ${Math.round(timeoutMs / 1000)} seconds`, detail }
  }
  return { kind: "unexpected", state: "unknown", text: `gave an error the check didn't expect (${detail})`, detail }
}

type Timed<T> = { ok: true; value: T; ms: number } | { ok: false; failure: R2Failure; ms: number }

/** One R2 call with its own abort timer; never throws. */
export async function timedR2<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<Timed<T>> {
  const started = Date.now()
  try {
    const value = await call(AbortSignal.timeout(timeoutMs))
    return { ok: true, value, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, failure: describeR2Error(e, timeoutMs), ms: Date.now() - started }
  }
}

const londonFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
})

export function agoText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return "less than a minute ago"
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`
  return `${Math.floor(h / 24)} days ago`
}

/** "Thu 10 Sept, 14:05 (35 minutes ago)", London time. */
export function fmtWhen(ms: number, nowMs: number): string {
  return `${londonFmt.format(new Date(ms))} (${agoText(nowMs - ms)})`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// ── The reference file ───────────────────────────────────────────────────────────────

type RefSource = "archive" | "bc" | "lot"
interface Ref { key: string; source: RefSource }

const SOURCE_LABEL: Record<RefSource, string> = {
  archive: "An ABC Database photo copy",
  bc: "A BC Database photo copy",
  lot: "A lot photo",
}

/** The chosen file survives between checks (and while the database is struggling), so the
 *  database is asked only when there is no file yet or the last one went missing. */
type RefMem = { primary: Ref | null; gone: string[]; noneUntil: number }

function refMem(): RefMem {
  const g = globalThis as unknown as { _statusStorageRef?: RefMem }
  return (g._statusStorageRef ??= { primary: null, gone: [], noneUntil: 0 })
}

function forget(ref: Ref): void {
  const m = refMem()
  if (m.primary?.key === ref.key) m.primary = null
  if (!m.gone.includes(ref.key)) m.gone.push(ref.key)
  if (m.gone.length > 50) m.gone.splice(0, m.gone.length - 50)
}

/** imageUrls holds R2 keys ("lot-photos/…"); skip anything that is a web address instead. */
const looksLikeKey = (u: string) => !!u && u.length < 1024 && !u.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(u)

async function pickFrom(source: RefSource, exclude: string[]): Promise<Ref | null> {
  // ⚠ Read-only, one column each. No ORDER BY on the archive tables: any photo will do,
  // and LIMIT 1 without a sort stops at the first match instead of sorting 950k rows.
  if (source === "archive") {
    const r = await prisma.archiveLot.findFirst({
      where: { AND: [{ photoKey: { not: null } }, { photoKey: { notIn: ["", ...exclude] } }] },
      select: { photoKey: true },
    })
    return r?.photoKey ? { key: r.photoKey, source } : null
  }
  if (source === "bc") {
    const r = await prisma.bcLotWeb.findFirst({
      where: { AND: [{ photoKey: { not: null } }, { photoKey: { notIn: ["", ...exclude] } }] },
      select: { photoKey: true },
    })
    return r?.photoKey ? { key: r.photoKey, source } : null
  }
  const rows = await prisma.catalogueLot.findMany({
    where: { imageUrls: { isEmpty: false } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { imageUrls: true },
  })
  for (const row of rows) for (const u of row.imageUrls) if (looksLikeKey(u) && !exclude.includes(u)) return { key: u, source }
  return null
}

/** First file found across `sources`, in order. Throws only if a table errored AND nothing was found. */
async function pickReference(exclude: string[], sources: RefSource[]): Promise<Ref | null> {
  let failed: unknown = null
  for (const s of sources) {
    try {
      const r = await pickFrom(s, exclude)
      if (r) return r
    } catch (e) {
      failed = e // a table not there yet (before Run Migrations) or the database not answering
    }
  }
  if (failed) throw failed
  return null
}

class PickTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const slow = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PickTimeout("timeout")), Math.max(0, ms)) })
  return Promise.race([p.finally(() => clearTimeout(timer)), slow])
}

/** The other tables first, so a second opinion never comes from the same place as the first. */
const othersFirst = (s: RefSource): RefSource[] => (["archive", "bc", "lot"] as RefSource[]).filter(x => x !== s).concat(s)

// ── Probing the main bucket ──────────────────────────────────────────────────────────

interface Part { state: StatusState; summary: string; facts: Fact[]; latencyMs?: number }

const refFact = (label: string, ref: Ref): Fact => ({ label, value: `${SOURCE_LABEL[ref.source]} (${ref.key})` })

function head(bucket: string, ref: Ref, timeoutMs: number) {
  return timedR2(signal => probeClient().send(new HeadObjectCommand({ Bucket: bucket, Key: ref.key }), { abortSignal: signal }), timeoutMs)
}

type BucketState = "has-files" | "empty" | "no-bucket" | "unknown"

/** Only used to explain a 404: a LIST answer carries a body, so it can say NoSuchBucket. */
async function bucketContents(bucket: string, timeoutMs: number): Promise<BucketState> {
  const r = await timedR2(signal => probeClient().send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }), { abortSignal: signal }), timeoutMs)
  if (r.ok) return (r.value.KeyCount ?? r.value.Contents?.length ?? 0) > 0 ? "has-files" : "empty"
  // ⚠ A 403 here may only mean the key isn't allowed to LIST (no Hub code lists this
  // bucket, so that permission is unproven) — never read it as "down".
  return r.failure.kind === "no-bucket" || r.failure.kind === "not-found" ? "no-bucket" : "unknown"
}

function readOk(ref: Ref, ms: number): Part {
  return {
    state: "ok",
    summary: "Photos and files can be read.",
    facts: [{ label: "Reading a file", value: `Worked in ${ms} ms`, tone: "good" }, refFact("File read back", ref)],
    latencyMs: ms,
  }
}

function readFailed(ref: Ref, f: R2Failure, ms: number): Part {
  const tail = f.state === "down" ? "so photos and files can't be loaded or uploaded"
    : f.state === "degraded" ? "so some photos may not load"
    : "so this couldn't be confirmed"
  return {
    state: f.state,
    summary: `Cloudflare storage ${f.text}, ${tail}.`,
    facts: [
      { label: "Reading a file", value: `Failed — ${f.detail}`, tone: f.state === "unknown" ? "warn" : "bad" },
      refFact("File tried", ref),
    ],
    latencyMs: ms,
  }
}

function noReference(why: "none" | "database" | "slow"): Part {
  const summary = why === "none"
    ? "There's no file on record to read back yet, so this couldn't be confirmed."
    : why === "slow"
      ? "The database took too long to suggest a file to read back, so this couldn't be confirmed."
      : "Couldn't pick a file to read back because the database didn't answer, so this couldn't be confirmed."
  return {
    state: "unknown",
    summary,
    facts: [{
      label: "Reading a file",
      value: why === "none"
        ? "Not tried: no ABC/BC Database photo copy or lot photo is on record in this environment"
        : "Not tried: the file to test is chosen from the database",
      tone: "warn",
    }],
  }
}

function missingFiles(refs: Ref[], bucket: BucketState): Part {
  const facts: Fact[] = refs.map((r, i) => ({ label: i === 0 ? "Missing file" : "Also missing", value: `${SOURCE_LABEL[r.source]} (${r.key})`, tone: "bad" as const }))
  if (bucket === "no-bucket") {
    return { state: "down", summary: "The storage bucket named in the Hub's settings doesn't exist, so photos and files can't be loaded or uploaded.", facts }
  }
  if (bucket === "empty") {
    return { state: "down", summary: "The storage bucket is empty — none of the Hub's photos or files are in it.", facts }
  }
  if (refs.length >= 2) {
    return {
      state: "down",
      summary: "Files the Hub has on record aren't in storage, so photos may not load — the bucket setting may point at the wrong place.",
      facts: [...facts, { label: "The bucket itself", value: bucket === "has-files" ? "Answers and holds other files" : "Couldn't be listed to say more" }],
    }
  }
  if (bucket === "has-files") {
    return {
      state: "degraded",
      summary: "Storage answers, but a file the Hub keeps for good has gone missing from it.",
      facts: [...facts, { label: "The bucket itself", value: "Answers and holds other files" }, { label: "Worth asking", value: "Nothing in the Hub deletes these files, so who removed it?" }],
    }
  }
  return { state: "unknown", summary: "A file the Hub keeps for good wasn't found, and nothing else could be confirmed.", facts }
}

async function probeMain(bucket: string, deadline: number): Promise<Part> {
  const mem = refMem()
  const left = () => deadline - Date.now()
  const callMs = () => Math.max(1_000, Math.min(CALL_TIMEOUT_MS, left()))

  let ref = mem.primary
  if (!ref) {
    if (Date.now() < mem.noneUntil) return noReference("none")
    try {
      ref = await withTimeout(pickReference(mem.gone, ["archive", "bc", "lot"]), Math.min(PICK_TIMEOUT_MS, left()))
    } catch (e) {
      // ⚠ Grey, never red: the database is a separate light, and not being able to choose
      // a file says nothing about Cloudflare.
      return noReference(e instanceof PickTimeout ? "slow" : "database")
    }
    if (!ref) { mem.noneUntil = Date.now() + NONE_RETRY_MS; return noReference("none") }
    mem.primary = ref
  }

  const first = await head(bucket, ref, callMs())
  if (first.ok) return readOk(ref, first.ms)
  if (first.failure.kind !== "not-found") return readFailed(ref, first.failure, first.ms)

  // 404 — the file has gone, or the bucket is wrong. A second file decides which.
  forget(ref)
  let second: Ref | null = null
  if (left() > 3_000) {
    try {
      second = await withTimeout(pickReference(refMem().gone, othersFirst(ref.source)), Math.min(PICK_TIMEOUT_MS, left() - 1_500))
    } catch { second = null }
  }
  if (second && left() > 1_500) {
    const again = await head(bucket, second, callMs())
    if (again.ok) {
      mem.primary = second
      const ok = readOk(second, again.ms)
      // A lot photo going missing is an ordinary day's work (cataloguers delete them);
      // an archive photo copy going missing is not — nothing in the Hub deletes those.
      if (ref.source === "lot") {
        return { ...ok, facts: [...ok.facts, { label: "Earlier test file", value: "A lot photo that has since been deleted — normal; a different file is used now" }] }
      }
      return {
        state: "degraded",
        summary: "Storage is working, but a file the Hub keeps for good has gone missing from it.",
        facts: [
          ...ok.facts,
          { label: "Missing file", value: `${SOURCE_LABEL[ref.source]} (${ref.key}) wasn't found. Nothing in the Hub deletes these, so worth asking who removed it. A different file is tested from now on.`, tone: "warn" },
        ],
        latencyMs: again.ms,
      }
    }
    if (again.failure.kind !== "not-found") return readFailed(second, again.failure, again.ms)
    forget(second)
  }

  const refs = second ? [ref, second] : [ref]
  const bucketState = left() > 1_500 ? await bucketContents(bucket, callMs()) : "unknown"
  // Only lot photos missing — with nothing sturdier on record to test — is not evidence of
  // anything: cataloguers delete them every day. Only the bucket itself being gone or empty
  // may turn that red.
  if (refs.every(r => r.source === "lot") && bucketState !== "no-bucket" && bucketState !== "empty") {
    return {
      state: "unknown",
      summary: "The lot photos chosen for the test have since been deleted, so this couldn't be confirmed.",
      facts: [
        { label: "Reading a file", value: "Not confirmed — no ABC/BC Database photo copy is on record here to test instead", tone: "warn" },
        { label: "The bucket itself", value: bucketState === "has-files" ? "Answers and holds other files" : "Couldn't be listed to say more" },
      ],
    }
  }
  return missingFiles(refs, bucketState)
}

// ── The backup bucket (reachability only — ./backup judges the backups themselves) ──────

type StorePart = { kind: "not-set" } | { kind: "ok"; ms: number } | { kind: "failed"; failure: R2Failure }

async function probeBackupStore(deadline: number): Promise<StorePart> {
  // ⚠ Test the variable itself: every backup route reads it with a non-null assertion, so
  // unset it becomes Bucket: undefined and the SDK throws — that is "not set up", not "down".
  const bucket = process.env.CLOUDFLARE_R2_BACKUP_BUCKET?.trim()
  if (!bucket) return { kind: "not-set" }
  // ⚠ Probed separately from the main bucket: a key limited to one bucket passes there and
  // is refused on the other. Same call /api/admin/backup makes, but one key is enough.
  const t = Math.max(1_000, Math.min(CALL_TIMEOUT_MS, deadline - Date.now()))
  const r = await timedR2(signal => probeClient().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: backupFolder(), MaxKeys: 1 }), { abortSignal: signal }), t)
  return r.ok ? { kind: "ok", ms: r.ms } : { kind: "failed", failure: r.failure }
}

function storeFact(s: StorePart): Fact {
  if (s.kind === "not-set") return { label: "Backup store", value: "Not set up on this environment" }
  if (s.kind === "ok") return { label: "Backup store", value: `Answered in ${s.ms} ms`, tone: "good" }
  return { label: "Backup store", value: `Cloudflare storage ${s.failure.text} (${s.failure.detail})`, tone: s.failure.state === "unknown" ? "warn" : "bad" }
}

// ── Uploads: passive, from rows written only after a file reached storage ───────────────

type Seen = { at: number; what: string } | null

async function newest(what: string, q: () => Promise<Date | null | undefined>): Promise<Seen | "error"> {
  try {
    const d = await q()
    return d ? { at: d.getTime(), what } : null
  } catch {
    return "error" // table not created yet on this environment, or the read failed
  }
}

function latest(list: (Seen | "error")[]): { seen: Seen; allFailed: boolean } {
  let seen: Seen = null
  for (const s of list) if (s && s !== "error" && (!seen || s.at > seen.at)) seen = s
  return { seen, allFailed: list.every(s => s === "error") }
}

async function uploadFacts(nowMs: number): Promise<Fact[]> {
  // ⚠ Each row below is written only AFTER its file reached R2, so each is proof a save
  // worked at that moment (storage research, reviewer's version). Split by route, because
  // they fail differently: the server saves with its own key, while browsers PUT straight to
  // R2 on a signed address — a path no server-side probe can see at all.
  // ⚠ Not ArchiveJob.updatedAt: the photo-copy loop bumps it even when nothing was uploaded.
  // ⚠ Every read is bounded to the last 30 days. CatalogueLotEvent is the lot change log (a row
  // per field edit); an unbounded "newest photo_added" walks its whole index backwards whenever
  // Photography has been quiet — every 5 minutes, on the production database.
  const since = new Date(nowMs - 30 * 24 * 60 * 60 * 1000)
  const recent = { createdAt: { gte: since } }
  const [server, browser] = await Promise.all([
    Promise.all([
      newest("an IT Job Board attachment", async () => (await prisma.iTJobAttachment.aggregate({ where: recent, _max: { createdAt: true } }))._max.createdAt),
      newest("a photo added to a lot", async () => (await prisma.catalogueLotEvent.findFirst({
        where: { action: "photo_added", changedAt: { gte: since } }, orderBy: { changedAt: "desc" }, select: { changedAt: true },
      }))?.changedAt),
    ]),
    Promise.all([
      newest("a screen recording", async () => (await prisma.screenRecording.aggregate({ where: recent, _max: { createdAt: true } }))._max.createdAt),
      newest("a screenshot", async () => (await prisma.screenCapture.aggregate({ where: recent, _max: { createdAt: true } }))._max.createdAt),
      newest("an Admin Document", async () => (await prisma.documentFile.aggregate({ where: recent, _max: { createdAt: true } }))._max.createdAt),
      newest("an invoice file", async () => (await prisma.invoiceFile.aggregate({ where: recent, _max: { createdAt: true } }))._max.createdAt),
    ]),
  ])
  const line = (label: string, l: ReturnType<typeof latest>): Fact => ({
    label,
    value: l.seen ? `${fmtWhen(l.seen.at, nowMs)} — ${l.seen.what}` : l.allFailed ? "Couldn't be read" : "None in the last 30 days",
  })
  return [
    line("Last upload saved by the server", latest(server)),
    line("Last upload straight from a browser", latest(browser)),
  ]
}

// ── Standing facts ─────────────────────────────────────────────────────────────────────

const UPLOADS_NOT_TESTED: Fact = {
  label: "Uploads",
  value: "Not tested directly — that would mean saving a file. The last saves on record are shown instead; no recent one on a busy day is worth a look.",
}
/** Off production the "last saves" lines aren't shown, so don't promise them. */
const UPLOADS_NOT_TESTED_HERE: Fact = { label: "Uploads", value: "Not tested directly — that would mean saving a file." }

/** Failures that belong to Cloudflare as a whole, not to one bucket: both buckets share the
 *  account address and the key. A refusal or a missing bucket can be true of one bucket alone. */
const ACCOUNT_WIDE = new Set<R2FailKind>(["dns", "network", "timeout", "server-error", "rate-limited"])
const NOT_PRODUCTION_UPLOADS: Fact = {
  label: "Recent uploads",
  value: "Shown on production only — this environment's database started as a copy of production's, so its dates would mix the two.",
}
const NOT_BACKED_UP: Fact = {
  label: "Backed up?",
  value: "No — the nightly backup copies the database, not these files. Storage holds the only copy of every photo.",
}

const storage: StatusCheckDef = {
  key: "storage",
  name: "Photo & file storage",
  group: "hub",
  what: "Lot photos, documents, screen recordings and the nightly backups (Cloudflare R2).",
  whenDown: "Photos won't load or upload, and documents can't be opened.",
  statusPage: "https://www.cloudflarestatus.com",
  intervalMin: 5,

  async run(ctx): Promise<CheckResult> {
    // ⚠ Before ANY call: with the account setting missing the address becomes
    // https://undefined.r2.cloudflarestorage.com and fails as a DNS error — a false red.
    const missing = missingSettings([...R2_CREDENTIAL_VARS, "CLOUDFLARE_R2_BUCKET"])
    if (missing.length) {
      return {
        state: "unknown",
        summary: "Photo storage isn't set up on this environment, so there's nothing to check.",
        facts: [{ label: "Missing settings", value: missing.join(", "), tone: "warn" }, NOT_BACKED_UP],
      }
    }

    const deadline = Date.now() + BUDGET_MS
    const [main, store, uploads] = await Promise.all([
      probeMain(process.env.CLOUDFLARE_R2_BUCKET!.trim(), deadline),
      probeBackupStore(deadline),
      // ⚠ Production only: the staging and sandbox databases are copies of production.
      ctx.isProduction
        ? withTimeout(uploadFacts(ctx.now.getTime()), UPLOAD_FACTS_TIMEOUT_MS)
            .catch((): Fact[] => [{ label: "Recent uploads", value: "Couldn't be read in time" }])
        : Promise.resolve([NOT_PRODUCTION_UPLOADS]),
    ])

    let state = main.state
    let summary = main.summary
    if (main.state === "ok") {
      if (store.kind === "failed" && store.failure.state !== "unknown") {
        state = "degraded"
        summary = `Photos and files can be read, but the backup store ${store.failure.text}.`
      } else if (store.kind === "ok") {
        summary = "Photos and files can be read, and the backup store answers."
      }
    } else if (main.state === "unknown" && store.kind === "failed" && ACCOUNT_WIDE.has(store.failure.kind)) {
      // ⚠ The file test couldn't run (nothing on record, database slow) but Cloudflare itself
      // couldn't be reached on the backup store — grey here would hide a real outage.
      state = store.failure.state
      summary = `Cloudflare storage ${store.failure.text}, so ${store.failure.state === "down" ? "photos and files can't be loaded or uploaded" : "some photos may not load"}.`
    }

    return {
      state,
      summary,
      facts: [...main.facts, storeFact(store), ...uploads, ctx.isProduction ? UPLOADS_NOT_TESTED : UPLOADS_NOT_TESTED_HERE, NOT_BACKED_UP],
      latencyMs: main.latencyMs,
    }
  },
}

export default storage
