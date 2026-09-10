"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { isMissingTable } from "@/lib/prisma-errors"
import { inAudience, parseQuestions } from "@/lib/feedback"
import type { FeedbackQuestion } from "@/lib/feedback-types"
import { FEATURE_QUESTION_TEXT, MAX_QUESTION_CHARS, MAX_QUESTIONS, newQuestionId } from "@/lib/feedback-types"
import { feedbackRole } from "@/app/(app)/admin/feedback/feedback-shared"

// 📝 Hub feedback — the admin's server actions (Admin → Feedback, /admin/feedback).
//
// ⚠ Every action RETURNS { ok, error } and never throws to the client: production redacts a
// thrown server-action message into "An error occurred in the Server Components render…"
// (RULES.md), and "the survey didn't send" must reach the admin in words.
//
// ⚠ Writes use updateMany / deleteMany / create-with-select: a plain update() reads the whole
// row back (the 2026-09-09 read-only day). updateMany also makes each status change a
// compare-and-set — `where: { id, status: "DRAFT" }` — so a double tap, or two admins at once,
// can never send a survey twice or reopen one somebody else just deleted.
//
// ⚠ Migration-safe: until Run Migrations creates the two tables, every action answers with a
// plain "press Run Migrations" rather than a stack trace.

export type ActionResult = { ok: boolean; error?: string }

/** What a save stored — handed back so the editor adopts the CLEANED values as its baseline
 *  (trimmed wording, blank questions dropped), rather than thinking it still has unsaved changes. */
export type SavedSurvey = {
  title: string
  intro: string | null
  questions: FeedbackQuestion[]
  audienceRoles: string[]
  audienceUserIds: string[]
}

const MAX_TITLE_CHARS = 150
const MAX_INTRO_CHARS = 1500
const MAX_ROLES = 60
const MAX_NAMED_PEOPLE = 1000

const NOT_MIGRATED =
  "The feedback tables don't exist on this database yet. Press Run Migrations at the bottom of the Admin page, then try again."

function fail(where: string, e: unknown): ActionResult {
  if (isMissingTable(e)) return { ok: false, error: NOT_MIGRATED }
  console.error(`feedback ${where} error:`, e)
  const msg = e instanceof Error ? e.message : String(e ?? "")
  return { ok: false, error: msg ? `Couldn't ${where}: ${msg}` : `Couldn't ${where} — please try again.` }
}

/** The REAL session, never the view-as one: only an admin can run a survey. */
async function adminSession() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") return null
  return session
}

/** Tell every open tab the set of open surveys changed, so a popup appears (or a top-bar button
 *  disappears) within seconds rather than on the next page load. Best-effort: without the custom
 *  server (next dev) there is no socket and the popup finds out on its next check instead. */
function announce() {
  try {
    ;(globalThis as { _io?: { emit: (e: string) => void } })._io?.emit("feedback:changed")
  } catch { /* socket unavailable — clients catch up on their next load */ }
}

function refresh(id?: string) {
  revalidatePath("/admin/feedback")
  if (id) revalidatePath(`/admin/feedback/${id}`)
}

function londonDateLong(d = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(d)
}

/** Questions from the editor, cleaned: text trimmed and capped, blanks dropped, capped at
 *  MAX_QUESTIONS, and every id unique — a missing or repeated id would make two questions share
 *  one answer box on the popup. */
function cleanQuestions(raw: unknown): FeedbackQuestion[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: FeedbackQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q !== "object") continue
    const text = String((q as { text?: unknown }).text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS)
    if (!text) continue
    let id = String((q as { id?: unknown }).id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)
    if (!id || seen.has(id)) id = newQuestionId()
    seen.add(id)
    out.push({ id, text })
    if (out.length >= MAX_QUESTIONS) break
  }
  return out
}

function cleanRoles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map(r => String(r ?? "").trim()).filter(r => r && r.length <= 80))].slice(0, MAX_ROLES)
}

/** How many people a survey reaches right now, read from the database (never the session —
 *  a token can be hours old), with the same rule the popup uses (lib/feedback.ts inAudience, and
 *  the superadmin-is-always-ADMIN rule via feedbackRole). */
async function audienceSize(s: { audienceRoles: string[]; audienceUserIds: string[] }): Promise<number> {
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } })
  return users.filter(u => inAudience(s, { id: u.id, role: feedbackRole(u) })).length
}

// ── Create ────────────────────────────────────────────────────────────────────

/** A new DRAFT: dated title, the feature-request question, nobody in the audience yet. */
export async function createSurvey(): Promise<ActionResult & { id?: string }> {
  try {
    const session = await adminSession()
    if (!session) return { ok: false, error: "Only an admin can create a survey." }
    const created = await prisma.feedbackSurvey.create({
      data: {
        title: `Hub feedback — ${londonDateLong()}`,
        intro: null,
        questions: [{ id: newQuestionId(), text: FEATURE_QUESTION_TEXT }] as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        audienceRoles: [],
        audienceUserIds: [],
        createdById: session.user.id ?? null,
        createdByName: session.user.name || session.user.email || "Admin",
      },
      select: { id: true },
    })
    refresh(created.id)
    return { ok: true, id: created.id }
  } catch (e) {
    return fail("create the survey", e)
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

/** Title, intro, questions and audience. Allowed in every status — Jordan can fix a typo in a
 *  survey that's already out; the answers already given keep the wording they were answered
 *  with (AnswerSnapshot), so nothing anybody said is rewritten. */
export async function updateSurvey(
  id: string,
  input: { title: string; intro: string | null; questions: FeedbackQuestion[]; audienceRoles: string[]; audienceUserIds: string[] },
): Promise<ActionResult & { survey?: SavedSurvey }> {
  try {
    const session = await adminSession()
    if (!session) return { ok: false, error: "Only an admin can change a survey." }
    if (!id || typeof id !== "string") return { ok: false, error: "No survey was given." }

    const title = String(input?.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS)
    if (!title) return { ok: false, error: "Give the survey a title — it's the heading of the popup." }
    const intro = String(input?.intro ?? "").trim().slice(0, MAX_INTRO_CHARS) || null
    const questions = cleanQuestions(input?.questions)
    const audienceRoles = cleanRoles(input?.audienceRoles)

    // Named people must be real, current users: an id from a deleted account would count
    // towards nothing and could never be unticked on screen.
    const wanted = [...new Set((Array.isArray(input?.audienceUserIds) ? input.audienceUserIds : []).map(String))].slice(0, MAX_NAMED_PEOPLE)
    const existing = wanted.length
      ? await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true } })
      : []
    const known = new Set(existing.map(u => u.id))
    const audienceUserIds = wanted.filter(u => known.has(u))

    const current = await prisma.feedbackSurvey.findUnique({ where: { id }, select: { status: true } })
    if (!current) return { ok: false, error: "That survey no longer exists — it may have been deleted." }

    // ⚠ An open survey must keep at least one question: an empty survey would pop up as a form
    // with nothing to fill in, and the top-bar button would open onto nothing.
    if (current.status === "OPEN" && questions.length === 0) {
      return { ok: false, error: "This survey is out with people, so it needs at least one question. Close it first if you want to empty it." }
    }

    // ⚠ The "open needs a question" rule is ALSO in the write's WHERE: the status read above can be
    // stale by the time this runs (another admin pressing Send out in between), and an empty open
    // survey would reach people's top-bar buttons as a form with nothing in it.
    const res = await prisma.feedbackSurvey.updateMany({
      where: questions.length === 0 ? { id, status: { not: "OPEN" } } : { id },
      data: { title, intro, questions: questions as unknown as Prisma.InputJsonValue, audienceRoles, audienceUserIds },
    })
    if (res.count === 0) {
      return questions.length === 0
        ? { ok: false, error: "This survey has just been sent out, so it needs at least one question. Reload the page to see where it is." }
        : { ok: false, error: "That survey no longer exists — it may have been deleted." }
    }

    // ⚠ Deliberately NO "feedback:changed" here, even for an open survey. Each save would make
    // every tab re-check, including ones where somebody is halfway through typing an answer into
    // this very popup. The live push is for sending out and closing (the spec); anyone added to
    // an open survey's audience gets it the next time their Hub checks.
    refresh(id)
    return { ok: true, survey: { title, intro, questions, audienceRoles, audienceUserIds } }
  } catch (e) {
    return fail("save the survey", e)
  }
}

// ── Status changes ────────────────────────────────────────────────────────────

/** The checks Send Out and Re-open share: something to answer, and someone to answer it. */
async function readyToGo(id: string): Promise<{ error?: string; people?: number; found: boolean }> {
  const s = await prisma.feedbackSurvey.findUnique({
    where: { id },
    select: { questions: true, audienceRoles: true, audienceUserIds: true },
  })
  if (!s) return { found: false, error: "That survey no longer exists — it may have been deleted." }
  if (parseQuestions(s.questions).length === 0) return { found: true, error: "Add at least one question before sending it out." }
  const people = await audienceSize(s)
  if (people === 0) return { found: true, error: "Nobody would get this yet — tick at least one role or person under Who gets it." }
  return { found: true, people }
}

/** DRAFT → OPEN. From this moment everyone in the audience gets the popup. */
export async function openSurvey(id: string): Promise<ActionResult & { people?: number }> {
  try {
    const session = await adminSession()
    if (!session) return { ok: false, error: "Only an admin can send a survey out." }
    const check = await readyToGo(id)
    if (check.error) return { ok: false, error: check.error }

    const res = await prisma.feedbackSurvey.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "OPEN", openedAt: new Date(), closedAt: null },
    })
    if (res.count === 0) return { ok: false, error: "This survey isn't a draft any more — somebody may have sent it out already. Reload the page to see where it is." }

    announce()
    refresh(id)
    return { ok: true, people: check.people }
  } catch (e) {
    return fail("send the survey out", e)
  }
}

/** OPEN → CLOSED. Popups stop, and the "fill it out later" buttons disappear from people's top
 *  bars (the popup side only shows OPEN surveys). Every answer already given is kept. */
export async function closeSurvey(id: string): Promise<ActionResult> {
  try {
    const session = await adminSession()
    if (!session) return { ok: false, error: "Only an admin can close a survey." }
    const res = await prisma.feedbackSurvey.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    })
    if (res.count === 0) return { ok: false, error: "This survey isn't out at the moment, so there was nothing to close. Reload the page to see where it is." }
    announce()
    refresh(id)
    return { ok: true }
  } catch (e) {
    return fail("close the survey", e)
  }
}

/** CLOSED → OPEN. Anyone in the audience who hasn't answered gets the popup again (or their
 *  top-bar button back, if they'd put it off). ⚠ openedAt is KEPT: it is when the survey first
 *  went out, and the popup side queues open surveys oldest-first by it. */
export async function reopenSurvey(id: string): Promise<ActionResult & { people?: number }> {
  try {
    const session = await adminSession()
    if (!session) return { ok: false, error: "Only an admin can re-open a survey." }
    const check = await readyToGo(id)
    if (check.error) return { ok: false, error: check.error }

    const res = await prisma.feedbackSurvey.updateMany({
      where: { id, status: "CLOSED" },
      data: { status: "OPEN", closedAt: null },
    })
    if (res.count === 0) return { ok: false, error: "This survey isn't closed, so there was nothing to re-open. Reload the page to see where it is." }
    // A survey closed before it was ever stamped as sent (shouldn't happen, but a hand-edited row
    // could) still needs a send date for the list and the popup's ordering.
    await prisma.feedbackSurvey.updateMany({ where: { id, openedAt: null }, data: { openedAt: new Date() } })

    announce()
    refresh(id)
    return { ok: true, people: check.people }
  } catch (e) {
    return fail("re-open the survey", e)
  }
}

/** Gone for good, with every answer (the responses cascade). The screen warns first when there
 *  are answers; this action doesn't second-guess it. */
export async function deleteSurvey(id: string): Promise<ActionResult & { answersDeleted?: number }> {
  try {
    const session = await adminSession()
    if (!session) return { ok: false, error: "Only an admin can delete a survey." }
    const s = await prisma.feedbackSurvey.findUnique({ where: { id }, select: { status: true } })
    if (!s) return { ok: false, error: "That survey no longer exists — it may already have been deleted." }
    const answers = await prisma.feedbackResponse.count({ where: { surveyId: id } })
    const res = await prisma.feedbackSurvey.deleteMany({ where: { id } })
    if (res.count === 0) return { ok: false, error: "That survey no longer exists — it may already have been deleted." }
    // Deleting an open survey takes its popup and top-bar buttons away from people.
    if (s.status === "OPEN") announce()
    refresh()
    return { ok: true, answersDeleted: answers }
  } catch (e) {
    return fail("delete the survey", e)
  }
}
