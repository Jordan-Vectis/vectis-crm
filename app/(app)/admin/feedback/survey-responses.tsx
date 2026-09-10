"use client"

import { useMemo, useState } from "react"
import type { SurveyStatus } from "@/lib/feedback-types"
import {
  BadgeKey, PERSON_STATUS_META, PERSON_STATUS_ORDER, PersonStatusBadge, answerFor, londonDateTime, roleLabel,
} from "./feedback-shared"
import type { PersonRow, QuestionColumn, SurveyCounts } from "./feedback-shared"
import ExportButton from "./export-button"

// The answers to one survey: how many have answered / said later / not answered yet, then every
// answer GROUPED BY QUESTION or BY PERSON, each with the person's name and when (London time).
//
// ⚠ Answers are shown with the wording they were answered with (their stored snapshot). If a
// question was reworded after somebody answered, their answer says "Asked as: …" rather than
// quietly sitting under words they were never shown.

type View = "question" | "person"

export default function SurveyResponses({ surveyId, status, people, columns, counts }: {
  surveyId: string
  status: SurveyStatus
  people: PersonRow[]
  columns: QuestionColumn[]
  counts: SurveyCounts
}) {
  const [view, setView] = useState<View>("question")
  const [search, setSearch] = useState("")

  const answered = people.filter(p => p.status === "SUBMITTED")
  const later = people.filter(p => p.status === "LATER" && p.inAudience)
  const notYet = people.filter(p => p.status === "NONE" && p.inAudience)
  const q = search.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!q) return answered
    return answered.filter(p => p.name.toLowerCase().includes(q) || p.answers.some(a => a.answer.toLowerCase().includes(q)))
  }, [answered, q])

  const card = "rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
  const tab = (active: boolean) =>
    `min-h-11 px-4 text-sm font-semibold transition-colors ${
      active ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-gray-950" : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
    }`

  if (status === "DRAFT" && people.every(p => p.status === "NONE")) {
    return (
      <section className={`${card} p-4 md:p-5`}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Answers</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Nothing yet — answers appear here once the survey has been sent out.</p>
      </section>
    )
  }

  return (
    <section className={`${card} p-4 md:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Answers</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Out of the {counts.audience} {counts.audience === 1 ? "person" : "people"} this survey is for today.
          </p>
        </div>
        <ExportButton surveyId={surveyId} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {([
          ["SUBMITTED", counts.answered],
          ["LATER", counts.later],
          ["NONE", counts.notYet],
        ] as const).map(([s, n]) => (
          <div key={s} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <PersonStatusBadge status={s} />
            <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              {n} <span className="text-base font-normal text-gray-500 dark:text-gray-400">of {counts.audience}</span>
            </p>
          </div>
        ))}
      </div>
      {counts.answeredOutside > 0 && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Plus {counts.answeredOutside} {counts.answeredOutside === 1 ? "person who" : "people who"} answered and {counts.answeredOutside === 1 ? "is" : "are"} no longer in
          the audience — their answers are still below.
        </p>
      )}

      <div className="mt-3">
        <BadgeKey items={PERSON_STATUS_ORDER.map(s => PERSON_STATUS_META[s])} />
      </div>

      {/* Who to chase — names only. */}
      {(later.length > 0 || notYet.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {later.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Said later ({later.length})</p>
              <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">{later.map(p => p.name).join(", ")}</p>
              <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                What they&apos;ve typed so far isn&apos;t shown here — it&apos;s theirs until they press Submit.
                {status === "CLOSED" ? " The survey is closed, so their top-bar button has gone." : ""}
              </p>
            </div>
          )}
          {notYet.length > 0 && (
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Not answered yet ({notYet.length})</p>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{notYet.map(p => p.name).join(", ")}</p>
            </div>
          )}
        </div>
      )}

      {answered.length === 0 ? (
        <p className="mt-5 text-sm text-gray-600 dark:text-gray-400">Nobody has submitted any answers yet.</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="inline-flex overflow-hidden rounded-xl border border-gray-300 dark:border-gray-600" role="tablist">
              <button type="button" role="tab" aria-selected={view === "question"} className={tab(view === "question")} onClick={() => setView("question")}>
                By question
              </button>
              <button type="button" role="tab" aria-selected={view === "person"} className={tab(view === "person")} onClick={() => setView("person")}>
                By person
              </button>
            </div>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search answers or names…"
              aria-label="Search answers"
              className="min-h-11 w-full max-w-sm rounded-xl border border-gray-300 bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            {q && <span className="text-sm text-gray-600 dark:text-gray-400">{matches.length} of {answered.length} people match</span>}
          </div>

          {view === "question" ? (
            <div className="mt-4 grid gap-4 2xl:grid-cols-2">
              {columns.map((c, i) => {
                const withAnswer = answered.filter(p => (answerFor(p, c.id)?.answer ?? "").trim())
                const blank = answered.length - withAnswer.length
                const shown = matches.filter(p => (answerFor(p, c.id)?.answer ?? "").trim())
                return (
                  <div key={c.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Question {i + 1}
                      {c.removed && <span className="ml-2 normal-case tracking-normal text-amber-700 dark:text-amber-400">· no longer in the survey</span>}
                    </p>
                    <h3 className="mt-1 font-semibold text-gray-900 dark:text-white">{c.heading}</h3>
                    {c.currentText && c.currentText !== c.heading && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Now worded: “{c.currentText}”</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {withAnswer.length} answered{blank > 0 ? ` · ${blank} left it blank` : ""}
                    </p>
                    {shown.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{q ? "No answers match the search." : "No answers to this one yet."}</p>
                    ) : (
                      <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                        {shown.map(p => {
                          const a = answerFor(p, c.id)!
                          return (
                            <li key={p.userId} className="py-3">
                              <p className="text-sm">
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                                <span className="text-gray-500 dark:text-gray-400"> · {londonDateTime(p.submittedAt)}</span>
                              </p>
                              {a.question.trim() && a.question.trim() !== c.heading && (
                                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Asked as: “{a.question}”</p>
                              )}
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200">{a.answer}</p>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {matches.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Nobody matches the search.</p>}
              {matches.map(p => (
                <div key={p.userId} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{p.name}</h3>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {p.role ? roleLabel(p.role) : "account deleted"}
                    </span>
                    {!p.inAudience && <span className="text-xs text-gray-500 dark:text-gray-400">no longer in the audience</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Submitted {londonDateTime(p.submittedAt)}</p>
                  <dl className="mt-3 space-y-3">
                    {p.answers.map(a => (
                      <div key={a.questionId}>
                        <dt className="text-xs font-semibold text-gray-600 dark:text-gray-400">{a.question}</dt>
                        <dd className={`mt-0.5 whitespace-pre-wrap break-words text-sm ${a.answer.trim() ? "text-gray-800 dark:text-gray-200" : "italic text-gray-400 dark:text-gray-500"}`}>
                          {a.answer.trim() || "left blank"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
