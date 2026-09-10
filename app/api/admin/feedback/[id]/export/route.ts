import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isMissingTable } from "@/lib/prisma-errors"
import { parseAnswers, parseQuestions } from "@/lib/feedback"
import {
  PERSON_STATUS_META, PERSON_STATUS_ORDER, answerFor, buildColumns, buildPeople, feedbackRole, londonDateTime, londonIsoDay, roleLabel,
} from "@/app/(app)/admin/feedback/feedback-shared"

// 📝 Admin → Hub Feedback → one survey → "⬇ Export to Excel (CSV)".
//
// One row per person (everyone in the audience, plus anyone who answered and was unticked
// since): Name, Role, Status, Submitted, then one column per question, headed with the wording
// people actually answered (their stored snapshot). Where somebody answered an earlier wording
// of a question, their cell says so — "[Asked as: …]" — so nobody's answer sits under words
// they were never shown.
//
// ⚠ UTF-8 WITH a BOM, or Excel opens it as Windows-1252 and every £ and accent comes out as
// mojibake. ⚠ Every cell that starts with = + - @ (or a tab / carriage return) is prefixed with
// an apostrophe: these are free-text answers, and Excel would otherwise run "=HYPERLINK(…)" typed
// into a feedback box as a formula (CSV formula injection).
//
// ⚠ "Said later" rows carry NO answer text — what someone has typed but not submitted is theirs
// until they press Submit (buildPeople never returns it).
export const dynamic = "force-dynamic"

function cell(v: unknown): string {
  let s = v == null ? "" : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const { id } = await params
    const survey = await prisma.feedbackSurvey.findUnique({
      where: { id },
      select: { title: true, questions: true, audienceRoles: true, audienceUserIds: true },
    })
    if (!survey) return NextResponse.json({ error: "That survey no longer exists." }, { status: 404 })

    const [responses, users] = await Promise.all([
      prisma.feedbackResponse.findMany({
        where: { surveyId: id },
        select: { userId: true, userName: true, status: true, answers: true, submittedAt: true },
      }),
      prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } })
        .then(us => us.map(u => ({ id: u.id, name: u.name, role: feedbackRole(u) }))),
    ])

    const people = buildPeople({
      audience: survey,
      users,
      responses: responses.map(r => ({ ...r, answers: parseAnswers(r.answers) })),
    })
    const columns = buildColumns(parseQuestions(survey.questions), people)
    const order = new Map(PERSON_STATUS_ORDER.map((s, i) => [s, i]))
    const sorted = [...people].sort((a, b) => (order.get(a.status)! - order.get(b.status)!) || a.name.localeCompare(b.name, "en-GB"))

    const header = [
      "Name", "Role", "Status", "Submitted",
      ...columns.map(c => (c.removed ? `${c.heading} (removed from the survey)` : c.heading)),
    ]
    const lines = [header.map(cell).join(",")]
    for (const p of sorted) {
      const status = PERSON_STATUS_META[p.status].word + (p.inAudience ? "" : " (no longer in the audience)")
      const answers = columns.map(c => {
        const a = answerFor(p, c.id)
        if (!a) return ""
        return a.question.trim() && a.question.trim() !== c.heading ? `[Asked as: "${a.question.trim()}"] ${a.answer}` : a.answer
      })
      lines.push([p.name, p.role ? roleLabel(p.role) : "(account deleted)", status, p.submittedAt ? londonDateTime(p.submittedAt) : "", ...answers].map(cell).join(","))
    }
    const body = "﻿" + lines.join("\r\n") + "\r\n"

    // A readable file name for Excel's title bar, plus a plain-ASCII fallback for browsers that
    // don't read filename* (the title usually carries an em dash).
    const base = `${survey.title} ${londonIsoDay()}`.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Hub feedback"
    const ascii = base.replace(/[^\x20-\x7E]+/g, "-").replace(/"/g, "")
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // ⚠ encodeURIComponent leaves ' ( ) * alone, but RFC 5987 doesn't allow them raw in
        // filename* — and a title like "Jordan's survey" is exactly the kind people write.
        "Content-Disposition": `attachment; filename="${ascii}.csv"; filename*=UTF-8''${encodeURIComponent(base + ".csv").replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    if (isMissingTable(e)) {
      return NextResponse.json({ error: "The feedback tables don't exist on this database yet — press Run Migrations on the Admin page." }, { status: 503 })
    }
    console.error("admin/feedback export error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 })
  }
}
