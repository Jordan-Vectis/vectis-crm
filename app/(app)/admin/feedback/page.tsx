import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isMissingTable } from "@/lib/prisma-errors"
import { inAudience, parseQuestions } from "@/lib/feedback"
import type { SurveyStatus } from "@/lib/feedback-types"
import NewSurveyButton from "./new-survey-button"
import {
  BadgeKey, SURVEY_STATUS_META, SURVEY_STATUS_ORDER, SurveyStatusBadge, feedbackRole, londonDate, roleLabel, safeSurveyStatus,
} from "./feedback-shared"

// 📝 Admin → Hub Feedback: every survey, where it's up to, and how many have answered.
//
// Jordan, 2026-09-10: "a section in admin I can add questions and give [the cataloguers] the
// opportunity to ask for features". Each survey is sent as a popup to the roles and/or people
// ticked on it; answers are named; "Fill it out later" puts a button in that person's top bar.
//
// ⚠ Migration-safe: the two tables only exist after Run Migrations, and code deploys first. A
// missing table is a plain note on the page, never a 500 — and is told apart from a real database
// fault, which would send the admin to a button that can't help.
export const dynamic = "force-dynamic"
export const metadata = { title: "Hub Feedback" }

type Row = {
  id: string
  title: string
  status: SurveyStatus
  questions: number
  audience: number
  who: string
  answered: number
  answeredOutside: number
  later: number
  createdAt: Date
  createdByName: string | null
  openedAt: Date | null
  closedAt: Date | null
}

type Problem = { kind: "migrate" } | { kind: "error"; message: string }

async function loadRows(): Promise<{ rows: Row[]; problem: Problem | null }> {
  try {
    const [surveys, responses, users] = await Promise.all([
      prisma.feedbackSurvey.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true, title: true, status: true, questions: true, audienceRoles: true, audienceUserIds: true,
          createdAt: true, createdByName: true, openedAt: true, closedAt: true,
        },
      }),
      prisma.feedbackResponse.findMany({ select: { surveyId: true, userId: true, status: true } }),
      prisma.user.findMany({ select: { id: true, email: true, role: true } })
        .then(us => us.map(u => ({ id: u.id, role: feedbackRole(u) }))),
    ])

    const bySurvey = new Map<string, { userId: string; status: string }[]>()
    for (const r of responses) bySurvey.set(r.surveyId, [...(bySurvey.get(r.surveyId) ?? []), r])
    const userIds = new Set(users.map(u => u.id))

    const rows = surveys.map((s): Row => {
      const members = new Set(users.filter(u => inAudience(s, u)).map(u => u.id))
      const rs = bySurvey.get(s.id) ?? []
      const named = s.audienceUserIds.filter(id => userIds.has(id)).length
      const roleWords = s.audienceRoles.map(roleLabel)
      const who = [roleWords.join(", "), named ? `${named} named ${named === 1 ? "person" : "people"}` : ""].filter(Boolean).join(" + ")
      return {
        id: s.id,
        title: s.title,
        status: safeSurveyStatus(s.status),
        questions: parseQuestions(s.questions).length,
        audience: members.size,
        who: who || "Nobody ticked yet",
        // Counted against who is in the audience NOW, so "answered N of M" can never read 13 of 12;
        // anyone who answered and was unticked afterwards is shown separately.
        answered: rs.filter(r => r.status === "SUBMITTED" && members.has(r.userId)).length,
        answeredOutside: rs.filter(r => r.status === "SUBMITTED" && !members.has(r.userId)).length,
        later: rs.filter(r => r.status === "LATER" && members.has(r.userId)).length,
        createdAt: s.createdAt,
        createdByName: s.createdByName,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
      }
    })
    return { rows, problem: null }
  } catch (e) {
    if (isMissingTable(e)) return { rows: [], problem: { kind: "migrate" } }
    console.error("admin/feedback list error:", e)
    return { rows: [], problem: { kind: "error", message: e instanceof Error ? e.message : String(e) } }
  }
}

export default async function FeedbackListPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const { rows, problem } = await loadRows()
  const card = "rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
  const th = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap"

  return (
    <div className="space-y-6 p-4 md:p-6 xl:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/admin" className="text-sm text-gray-500 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-400">← Admin</Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">📝 Hub Feedback</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            Ask the people using the Hub what they think of it and what they&apos;d like it to do. Each survey pops up on the
            screens of the people you choose. Their name goes with their answers.
          </p>
        </div>
        <NewSurveyButton disabled={problem?.kind === "migrate"} />
      </div>

      {problem?.kind === "migrate" && (
        <div className={`${card} border-amber-400/70 p-4 dark:border-amber-500/60`}>
          <p className="text-sm text-amber-800 dark:text-amber-300">
            The feedback tables don&apos;t exist on this database yet. Press <strong>Run Migrations</strong> at the bottom of
            the <Link href="/admin" className="underline">Admin page</Link>, then come back here.
          </p>
        </div>
      )}

      {problem?.kind === "error" && (
        <div className={`${card} border-red-400/70 p-4 dark:border-red-500/60`}>
          <p className="text-sm text-red-700 dark:text-red-300">
            Couldn&apos;t read the surveys: {problem.message}. This isn&apos;t a missing migration, so Run Migrations won&apos;t
            help — try reloading, and check the Status Centre if it keeps happening.
          </p>
        </div>
      )}

      {!problem && rows.length === 0 && (
        <div className={`${card} p-6`}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">No surveys yet</h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            A survey is a short set of written questions that pops up on people&apos;s screens — on the tablets or anywhere else
            they use the Hub. Use it to find out what&apos;s getting in their way and which features they&apos;d like next.
          </p>
          <ol className="mt-4 grid gap-3 text-sm text-gray-700 dark:text-gray-300 sm:grid-cols-2 xl:grid-cols-4">
            <li className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60"><strong>1. Press New survey.</strong> It starts with one question asking which features they&apos;d like.</li>
            <li className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60"><strong>2. Write your questions</strong> — or let ✨ AI suggest some, then change them however you like.</li>
            <li className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60"><strong>3. Choose who gets it</strong> — whole roles, named people, or both.</li>
            <li className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60"><strong>4. Send it out.</strong> They can answer straight away or press &quot;Fill it out later&quot;. Answers collect here, ready to export to Excel.</li>
          </ol>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className={`${card} px-4 py-3`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Key</p>
            <BadgeKey items={SURVEY_STATUS_ORDER.map(s => SURVEY_STATUS_META[s])} />
          </div>

          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/60">
                <tr>
                  <th className={th}>Survey</th>
                  <th className={th}>Status</th>
                  <th className={th}>Who gets it</th>
                  <th className={th}>Answered</th>
                  <th className={th}>Said later</th>
                  <th className={th}>Created</th>
                  <th className={th}>Sent out</th>
                  <th className={th}>Closed</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map(r => {
                  const sent = r.status !== "DRAFT"
                  const pct = r.audience > 0 ? Math.round((r.answered / r.audience) * 100) : 0
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3 align-top">
                        <Link href={`/admin/feedback/${r.id}`} className="font-semibold text-gray-900 hover:text-emerald-600 dark:text-gray-100 dark:hover:text-emerald-400">
                          {r.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {r.questions} {r.questions === 1 ? "question" : "questions"}
                          {r.createdByName ? ` · by ${r.createdByName}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top"><SurveyStatusBadge status={r.status} /></td>
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium text-gray-800 dark:text-gray-200">{r.audience} {r.audience === 1 ? "person" : "people"}</p>
                        <p className="max-w-[260px] text-xs text-gray-500 dark:text-gray-400">{r.who}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {sent ? (
                          <>
                            <p className="font-medium text-gray-800 dark:text-gray-200">{r.answered} of {r.audience}</p>
                            <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" aria-hidden>
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            </div>
                            {r.answeredOutside > 0 && (
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">+ {r.answeredOutside} no longer in the audience</p>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-gray-400">Not sent yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {sent ? (
                          <span className={r.later > 0 ? "font-medium text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400"}>{r.later}</span>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-gray-600 dark:text-gray-400">{londonDate(r.createdAt)}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-gray-600 dark:text-gray-400">{londonDate(r.openedAt)}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-gray-600 dark:text-gray-400">{londonDate(r.closedAt)}</td>
                      <td className="px-4 py-3 text-right align-top">
                        <Link
                          href={`/admin/feedback/${r.id}`}
                          className="inline-flex min-h-11 items-center rounded-xl border border-gray-300 px-4 font-semibold text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
                        >
                          Open →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            &quot;Who gets it&quot; and &quot;Answered&quot; are counted against the people in each survey&apos;s audience today — someone who
            changes role moves in or out of a survey sent to a role.
          </p>
        </>
      )}
    </div>
  )
}
