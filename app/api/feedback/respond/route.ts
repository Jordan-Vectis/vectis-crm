import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { inAudience, parseQuestions, snapshotAnswers } from "@/lib/feedback"
import type { AnswerSnapshot } from "@/lib/feedback-types"

export const dynamic = "force-dynamic"

// 📝 POST /api/feedback/respond { surveyId, action: "later" | "submit", answers: { [questionId]: text } }
//   → { ok: true }  ·  { error }  ·  { error, gone } when the survey can no longer take this
//   person's answers (the popup then closes it, or tells them the way out).
//
// ⚠ The REAL signed-in user (auth()), never the "view as" one — answers are NAMED, and nobody may
// answer on someone else's behalf. Role read fresh from the database, not the session token.
//
// "later" keeps whatever is typed (even nothing) and puts the top-bar button up for them.
// "submit" needs at least one answer, and is final: ⚠ a SUBMITTED response can never go back to
// LATER, nor have its answers replaced by a stale second tab (see save()).

// ⚠ Word for word the same as the check in components/feedback-form.tsx.
const NEED_ONE_ANSWER = "Please answer at least one question, or press Fill it out later"

type Gone = "closed" | "missing" | "audience" | "submitted"

function gone(gone: Gone, error: string, status: number) {
  return NextResponse.json({ error, gone }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const surveyId = typeof body?.surveyId === "string" ? body.surveyId.trim() : ""
    const action = body?.action === "submit" || body?.action === "later" ? body.action : null
    if (!surveyId || !action) {
      return NextResponse.json({ error: "Something was missing from the request — please try again." }, { status: 400 })
    }
    // Text only: snapshotAnswers String()s whatever it's given, so an object or a number sent here
    // would otherwise be stored as "[object Object]" and read as a real answer.
    const given: Record<string, string> = {}
    if (body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
      for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) if (typeof v === "string") given[k] = v
    }

    const me = await currentUser(session.user.id)
    if (!me) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const survey = await prisma.feedbackSurvey.findUnique({
      where: { id: surveyId },
      select: { status: true, questions: true, audienceRoles: true, audienceUserIds: true },
    })
    if (!survey) return gone("missing", "This survey no longer exists, so answers can't be sent to it.", 404)
    if (survey.status !== "OPEN") return gone("closed", "This survey has been closed, so answers can't be sent to it any more.", 409)
    if (!inAudience(survey, me)) return gone("audience", "This survey is no longer one you've been asked to answer.", 403)

    // Stored WITH the wording of each question, matched to the survey's CURRENT questions.
    const answers = snapshotAnswers(parseQuestions(survey.questions), given)
    if (action === "submit" && !answers.some(a => a.answer)) {
      return NextResponse.json({ error: NEED_ONE_ANSWER }, { status: 400 })
    }

    const outcome = await save(surveyId, me.id, {
      userName: me.name,
      status: action === "submit" ? "SUBMITTED" : "LATER",
      answers,
      submittedAt: action === "submit" ? new Date() : null,
    })
    if (outcome === "submitted") return gone("submitted", "You'd already sent your answers to this survey — thank you.", 409)

    return NextResponse.json({ ok: true })
  } catch (e) {
    // Logged in full; the person on the iPad gets plain English (the popup keeps what they typed).
    console.error("feedback respond POST error:", e)
    return NextResponse.json({ error: "Couldn't save your answers just now — please try again in a moment." }, { status: 500 })
  }
}

type Row = { userName: string | null; status: "LATER" | "SUBMITTED"; answers: AnswerSnapshot[]; submittedAt: Date | null }

/** The upsert on (surveyId, userId) — with the one rule folded into it.
 *
 *  ⚠ Only a LATER row is ever written over, and that's checked in the UPDATE's WHERE, not by
 *  reading first and writing after: two tabs racing (one pressing Submit, one Later) cannot slip a
 *  SUBMITTED response back to LATER between a read and a write. updateMany/create with a minimal
 *  select, so Prisma never reads the whole row back. */
async function save(surveyId: string, userId: string, row: Row): Promise<"ok" | "submitted"> {
  const overwriteLater = () => prisma.feedbackResponse.updateMany({ where: { surveyId, userId, status: "LATER" }, data: row })

  if ((await overwriteLater()).count > 0) return "ok"

  const existing = await prisma.feedbackResponse.findUnique({
    where: { surveyId_userId: { surveyId, userId } },
    select: { id: true },
  })
  // A row that the LATER-only update skipped can only be a SUBMITTED one.
  if (existing) return "submitted"

  try {
    await prisma.feedbackResponse.create({ data: { surveyId, userId, ...row }, select: { id: true } })
    return "ok"
  } catch (e) {
    // P2002 = another tab created the row between the two steps above. Go round once more.
    if ((e as { code?: string } | null)?.code !== "P2002") throw e
    return (await overwriteLater()).count > 0 ? "ok" : "submitted"
  }
}

/** Role read FRESH from the database — the session token can be hours old, and a survey's
 *  audience is chosen by role. Name from the database too: it is what goes on the answers.
 *  (Same small helper as app/api/feedback/mine/route.ts.) */
async function currentUser(id: string): Promise<{ id: string; name: string | null; role: string } | null> {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, role: true } })
  if (!u) return null
  // The same superadmin rule auth.ts applies at sign-in: it@vectis.co.uk is always ADMIN.
  const role = u.email?.toLowerCase() === "it@vectis.co.uk" ? "ADMIN" : String(u.role)
  return { id: u.id, name: u.name ?? null, role }
}
