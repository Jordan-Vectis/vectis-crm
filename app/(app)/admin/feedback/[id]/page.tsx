import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isMissingTable } from "@/lib/prisma-errors"
import { parseAnswers, parseQuestions } from "@/lib/feedback"
import SurveyEditor, { type EditorSurvey, type EditorUser, type RoleOption } from "../survey-editor"
import SurveyResponses from "../survey-responses"
import {
  SurveyStatusBadge, buildColumns, buildPeople, countPeople, feedbackRole, londonDateTime, safeSurveyStatus,
} from "../feedback-shared"

// 📝 Admin → Hub Feedback → one survey: write it, choose who gets it, preview it, send it out,
// and read the answers.
//
// Server half: the admin gate (the REAL session — same as /admin), and one read of everything
// the editor and the answers need. ⚠ Migration-safe like the list: a missing table is a plain
// note, never a 500.
//
// ⚠ Unsubmitted "fill it out later" drafts are stripped HERE, by buildPeople(), so their text is
// never even sent to the browser.
export const dynamic = "force-dynamic"
export const metadata = { title: "Hub Feedback" }

export default async function FeedbackSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")
  const { id } = await params

  let loaded: {
    survey: {
      id: string; title: string; intro: string | null; questions: unknown; status: string
      audienceRoles: string[]; audienceUserIds: string[]; createdByName: string | null
      createdAt: Date; openedAt: Date | null; closedAt: Date | null
    } | null
    responses: { userId: string; userName: string | null; status: string; answers: unknown; submittedAt: Date | null }[]
    users: { id: string; name: string; role: string }[]
    roleDefaults: { role: string }[]
  } | null = null
  let problem: { kind: "migrate" } | { kind: "error"; message: string } | null = null

  try {
    const survey = await prisma.feedbackSurvey.findUnique({
      where: { id },
      select: {
        id: true, title: true, intro: true, questions: true, status: true, audienceRoles: true, audienceUserIds: true,
        createdByName: true, createdAt: true, openedAt: true, closedAt: true,
      },
    })
    const [responses, users, roleDefaults] = survey
      ? await Promise.all([
          prisma.feedbackResponse.findMany({
            where: { surveyId: id },
            select: { userId: true, userName: true, status: true, answers: true, submittedAt: true },
          }),
          prisma.user.findMany({ select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } })
            .then(us => us.map(u => ({ id: u.id, name: u.name, role: feedbackRole(u) }))),
          prisma.roleDefault.findMany({ select: { role: true } }),
        ])
      : [[], [], []]
    loaded = { survey, responses, users, roleDefaults }
  } catch (e) {
    if (isMissingTable(e)) problem = { kind: "migrate" }
    else {
      console.error("admin/feedback/[id] error:", e)
      problem = { kind: "error", message: e instanceof Error ? e.message : String(e) }
    }
  }

  const back = (
    <Link href="/admin/feedback" className="text-sm text-gray-500 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-400">← Hub Feedback</Link>
  )

  if (problem || !loaded) {
    return (
      <div className="space-y-4 p-4 md:p-6 xl:p-8">
        {back}
        <div className={`rounded-2xl border bg-white p-4 dark:bg-gray-900 ${problem?.kind === "migrate"
          ? "border-amber-400/70 dark:border-amber-500/60"
          : "border-red-400/70 dark:border-red-500/60"}`}>
          {problem?.kind === "migrate" ? (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              The feedback tables don&apos;t exist on this database yet. Press <strong>Run Migrations</strong> at the bottom of the{" "}
              <Link href="/admin" className="underline">Admin page</Link>, then come back.
            </p>
          ) : (
            <p className="text-sm text-red-700 dark:text-red-300">
              Couldn&apos;t read this survey{problem?.kind === "error" ? `: ${problem.message}` : ""}. Try reloading — Run Migrations won&apos;t help with this one.
            </p>
          )}
        </div>
      </div>
    )
  }

  const { survey, responses, users, roleDefaults } = loaded
  if (!survey) notFound()

  const status = safeSurveyStatus(survey.status)
  const questions = parseQuestions(survey.questions)
  const userIds = new Set(users.map(u => u.id))

  // Every role anyone could tick: ADMIN, every role on Roles & Defaults, any role in use on a
  // user (the same list the Users page builds) — plus any role this survey already ticks that has
  // since disappeared, so it can still be seen and unticked rather than silently kept.
  const roleNames = [...new Set(["ADMIN", ...roleDefaults.map(r => r.role), ...users.map(u => u.role), ...survey.audienceRoles])]
    .filter(Boolean)
    .sort((a, b) => (a === "ADMIN" ? -1 : b === "ADMIN" ? 1 : a.localeCompare(b)))
  const roles: RoleOption[] = roleNames.map(role => ({ role, count: users.filter(u => u.role === role).length }))

  const editorSurvey: EditorSurvey = {
    id: survey.id,
    title: survey.title,
    intro: survey.intro,
    questions,
    status,
    audienceRoles: survey.audienceRoles,
    // A named person whose account has gone can't be shown or unticked — drop them here, and the
    // next save drops them from the row too.
    audienceUserIds: survey.audienceUserIds.filter(u => userIds.has(u)),
    openedAt: survey.openedAt ? survey.openedAt.toISOString() : null,
    closedAt: survey.closedAt ? survey.closedAt.toISOString() : null,
  }
  const editorUsers: EditorUser[] = users

  const people = buildPeople({
    audience: { audienceRoles: survey.audienceRoles, audienceUserIds: survey.audienceUserIds },
    users,
    responses: responses.map(r => ({ ...r, answers: parseAnswers(r.answers) })),
  })
  const counts = countPeople(people)
  const columns = buildColumns(questions, people)

  return (
    <div className="space-y-6 p-4 md:p-6 xl:p-8">
      <div>
        {back}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{survey.title}</h1>
          <SurveyStatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Created {londonDateTime(survey.createdAt)}{survey.createdByName ? ` by ${survey.createdByName}` : ""}
          {survey.openedAt ? ` · Sent out ${londonDateTime(survey.openedAt)}` : ""}
          {status === "CLOSED" && survey.closedAt ? ` · Closed ${londonDateTime(survey.closedAt)}` : ""}
        </p>
      </div>

      <SurveyEditor
        survey={editorSurvey}
        users={editorUsers}
        roles={roles}
        counts={counts}
        laterCount={people.filter(p => p.status === "LATER").length}
      />

      <SurveyResponses surveyId={survey.id} status={status} people={people} columns={columns} counts={counts} />
    </div>
  )
}
