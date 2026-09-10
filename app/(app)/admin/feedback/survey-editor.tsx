"use client"

import { useEffect, useRef, useState } from "react"
import type { TextareaHTMLAttributes } from "react"
import { useRouter } from "next/navigation"
import FeedbackForm from "@/components/feedback-form"
import type { FeedbackQuestion, SurveyStatus } from "@/lib/feedback-types"
import { FEATURE_QUESTION_TEXT, MAX_QUESTION_CHARS, MAX_QUESTIONS, newQuestionId } from "@/lib/feedback-types"
import { closeSurvey, deleteSurvey, openSurvey, reopenSurvey, updateSurvey } from "@/lib/actions/feedback"
import type { SavedSurvey } from "@/lib/actions/feedback"
import AudiencePicker from "./audience-picker"
import AiSuggest from "./ai-suggest"
import ExportButton from "./export-button"
import { Spinner, audienceIncludes, londonDateTime } from "./feedback-shared"
import type { SurveyCounts } from "./feedback-shared"

// 📝 One survey's editor: the popup's heading and message, the questions, AI suggestions, who
// gets it, a preview, and Send out / Close / Re-open / Delete.
//
// Changes are kept on screen until "Save changes" (or Send out, which saves first) — one explicit
// save rather than a save per keystroke, so a flaky tablet connection can't half-save a survey,
// and an unsaved edit is always visible as such (the bar at the bottom, and a warning on leaving).
//
// ⚠ Confirm steps are INLINE, never window.confirm(): a native dialog on an iPad is easy to
// dismiss by accident, and it can't say how many people are about to get the popup in a way
// anyone reads. The Send out confirmation states the exact number.
//
// ⚠ Status (Draft / Sent out / Closed) comes from the server's props, never from local state:
// after each action the page is revalidated and the badge shows what the database says.

export type EditorSurvey = {
  id: string
  title: string
  intro: string | null
  questions: FeedbackQuestion[]
  status: SurveyStatus
  audienceRoles: string[]
  audienceUserIds: string[]
  openedAt: string | null
  closedAt: string | null
}
export type EditorUser = { id: string; name: string; role: string }
export type RoleOption = { role: string; count: number }

type Busy = null | "save" | "open" | "close" | "reopen" | "delete"
type Confirm = null | "open" | "close" | "reopen" | "delete"
type Notice = { tone: "good" | "bad"; text: string } | null

const OFFLINE = "Couldn't reach the Hub's server — check the connection and try again. If it keeps happening, reload the page to see where things stand."
const clean = (s: string) => s.replace(/\s+/g, " ").trim()

/** What "unsaved" is measured against — the same trimming the server does, so typing a trailing
 *  space and deleting it again doesn't leave the page claiming there are unsaved changes. */
function fingerprint(title: string, intro: string, questions: FeedbackQuestion[], roles: string[], userIds: string[]): string {
  return JSON.stringify({
    t: clean(title),
    i: intro.trim(),
    q: questions.map(q => [q.id, clean(q.text)]).filter(q => q[1]),
    r: [...roles].sort(),
    u: [...userIds].sort(),
  })
}

/** Grows with its text, so a long question is readable without an inner scrollbar. */
function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return <textarea ref={ref} rows={1} {...props} />
}

export default function SurveyEditor({ survey, users, roles, counts, laterCount }: {
  survey: EditorSurvey
  users: EditorUser[]
  roles: RoleOption[]
  counts: SurveyCounts
  /** People who pressed "Fill it out later" (their drafts go if the survey is deleted). */
  laterCount: number
}) {
  const router = useRouter()
  const status = survey.status

  const [title, setTitle] = useState(survey.title)
  const [intro, setIntro] = useState(survey.intro ?? "")
  const [questions, setQuestions] = useState<FeedbackQuestion[]>(survey.questions)
  const [roleSel, setRoleSel] = useState<string[]>(survey.audienceRoles)
  const [userSel, setUserSel] = useState<string[]>(survey.audienceUserIds)
  const [baseline, setBaseline] = useState(() =>
    fingerprint(survey.title, survey.intro ?? "", survey.questions, survey.audienceRoles, survey.audienceUserIds),
  )
  const [newText, setNewText] = useState("")
  const [removed, setRemoved] = useState<{ q: FeedbackQuestion; index: number } | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [preview, setPreview] = useState(false)

  const dirty = fingerprint(title, intro, questions, roleSel, userSel) !== baseline
  const usable = questions.filter(q => clean(q.text))
  const reached = users.filter(u => audienceIncludes({ audienceRoles: roleSel, audienceUserIds: userSel }, u)).length
  const room = MAX_QUESTIONS - questions.length
  const answeredTotal = counts.answered + counts.answeredOutside

  // An unsaved survey is lost on a reload or a closed tab — say so before it happens.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [dirty])

  function adopt(s: SavedSurvey) {
    setTitle(s.title)
    setIntro(s.intro ?? "")
    setQuestions(s.questions)
    setRoleSel(s.audienceRoles)
    setUserSel(s.audienceUserIds)
    setBaseline(fingerprint(s.title, s.intro ?? "", s.questions, s.audienceRoles, s.audienceUserIds))
  }

  /** Saves what's on screen. Reports its own failure; returns whether it worked. */
  async function saveNow(): Promise<boolean> {
    const res = await updateSurvey(survey.id, {
      title, intro: intro.trim() ? intro : null, questions, audienceRoles: roleSel, audienceUserIds: userSel,
    })
    if (!res.ok || !res.survey) {
      setNotice({ tone: "bad", text: res.error ?? "Your changes weren't saved — please try again." })
      return false
    }
    adopt(res.survey)
    return true
  }

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind)
    setNotice(null)
    try {
      await fn()
    } catch {
      setNotice({ tone: "bad", text: OFFLINE })
    } finally {
      setBusy(null)
    }
  }

  const onSave = () =>
    run("save", async () => {
      const dropped = questions.length - usable.length
      if (await saveNow()) {
        setNotice({
          tone: "good",
          text: `✓ Saved at ${londonDateTime(new Date()).split(", ").pop()}.` + (dropped > 0 ? ` ${dropped} empty question${dropped === 1 ? " was" : "s were"} left out.` : ""),
        })
      }
    })

  /** The checks before a confirm step appears — so the confirm never offers something that
   *  would only fail. The server checks the same things again. */
  function askToSend(kind: "open" | "reopen") {
    setNotice(null)
    if (!clean(title)) return setNotice({ tone: "bad", text: "Give the survey a title first — it's the heading of the popup." })
    if (usable.length === 0) return setNotice({ tone: "bad", text: "Add at least one question first." })
    if (reached === 0) return setNotice({ tone: "bad", text: "Nobody would get it yet — tick at least one role or person under Who gets it." })
    setConfirm(kind)
  }

  const doSend = (kind: "open" | "reopen") =>
    run(kind, async () => {
      if (dirty && !(await saveNow())) return
      const res = kind === "open" ? await openSurvey(survey.id) : await reopenSurvey(survey.id)
      setConfirm(null)
      if (!res.ok) return setNotice({ tone: "bad", text: res.error ?? "It wasn't sent — please try again." })
      const n = res.people ?? reached
      setNotice({
        tone: "good",
        text: kind === "open"
          ? `✓ Sent out to ${n} ${n === 1 ? "person" : "people"}. It pops up for anyone using the Hub now, and for everyone else the next time they open it.`
          : `✓ Re-opened for ${n} ${n === 1 ? "person" : "people"}. Anyone who hasn't answered gets the popup again, or their top-bar button back if they'd said later.`,
      })
      router.refresh()
    })

  const doClose = () =>
    run("close", async () => {
      const res = await closeSurvey(survey.id)
      setConfirm(null)
      if (!res.ok) return setNotice({ tone: "bad", text: res.error ?? "It wasn't closed — please try again." })
      setNotice({ tone: "good", text: "✓ Closed. The popup has stopped and the \"fill it out later\" buttons have gone. Every answer is kept below." })
      router.refresh()
    })

  const doDelete = () =>
    run("delete", async () => {
      const res = await deleteSurvey(survey.id)
      if (!res.ok) {
        setConfirm(null)
        return setNotice({ tone: "bad", text: res.error ?? "It wasn't deleted — please try again." })
      }
      // Stay "Deleting…" until the list replaces this page, so the button can't be pressed twice.
      setBaseline(fingerprint(title, intro, questions, roleSel, userSel))
      router.push("/admin/feedback")
      await new Promise(r => setTimeout(r, 4000))
    })

  // ── Questions ──────────────────────────────────────────────────────────────

  /** New questions go in ABOVE the feature-request question while it is last, so it stays the
   *  closing question the way every survey starts. Anything can still be moved with the arrows. */
  function insertAt(list: FeedbackQuestion[]): number {
    const last = list[list.length - 1]
    return last && clean(last.text) === FEATURE_QUESTION_TEXT ? list.length - 1 : list.length
  }

  function addQuestions(texts: string[]) {
    setQuestions(prev => {
      const fresh = texts.map(t => clean(t).slice(0, MAX_QUESTION_CHARS)).filter(Boolean).slice(0, MAX_QUESTIONS - prev.length)
      if (!fresh.length) return prev
      const at = insertAt(prev)
      return [...prev.slice(0, at), ...fresh.map(text => ({ id: newQuestionId(), text })), ...prev.slice(at)]
    })
    setRemoved(null)
  }

  function addTyped() {
    if (!clean(newText) || room <= 0) return
    addQuestions([newText])
    setNewText("")
  }

  function move(i: number, dir: -1 | 1) {
    setQuestions(prev => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function remove(i: number) {
    const q = questions[i]
    if (!q) return
    setRemoved({ q, index: i })
    setQuestions(prev => prev.filter(x => x.id !== q.id))
  }

  function undoRemove() {
    if (!removed) return
    setQuestions(prev => {
      if (prev.length >= MAX_QUESTIONS) return prev
      const at = Math.min(removed.index, prev.length)
      return [...prev.slice(0, at), removed.q, ...prev.slice(at)]
    })
    setRemoved(null)
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const card = "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 md:p-5"
  const input = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500"
  const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold disabled:opacity-40"
  const primary = `${btn} bg-emerald-600 text-white hover:bg-emerald-500`
  const secondary = `${btn} border border-gray-300 text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800`
  const danger = `${btn} border border-red-400 text-red-600 hover:bg-red-500/10 dark:border-red-500/70 dark:text-red-400`
  const dangerSolid = `${btn} bg-red-600 text-white hover:bg-red-500`
  const iconBtn = "flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 text-lg text-gray-700 hover:bg-gray-100 disabled:opacity-30 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
  const anyBusy = busy !== null

  const statusLine =
    status === "DRAFT"
      ? "Draft — nobody can see it yet."
      : status === "OPEN"
        ? `Out since ${londonDateTime(survey.openedAt)} · ${counts.answered} of ${counts.audience} answered · ${counts.later} said later`
        : `Closed ${londonDateTime(survey.closedAt)} · ${counts.answered} of ${counts.audience} answered`

  return (
    <div className="space-y-6">
      {/* ── Actions: where it's up to, and what can be done next ─────────────── */}
      <section className={card}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{statusLine}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondary} onClick={() => setPreview(true)} disabled={usable.length === 0}
              title={usable.length === 0 ? "Add a question first" : undefined}>
              👁 Preview the popup
            </button>
            <button type="button" className={dirty ? primary : secondary} onClick={onSave} disabled={!dirty || anyBusy}>
              {busy === "save" ? <><Spinner /> Saving…</> : dirty ? "💾 Save changes" : "✓ All changes saved"}
            </button>
            {status === "DRAFT" && (
              <button type="button" className={primary} onClick={() => askToSend("open")} disabled={anyBusy}>📤 Send it out…</button>
            )}
            {status === "OPEN" && (
              <button type="button" className={secondary} onClick={() => { setNotice(null); setConfirm("close") }} disabled={anyBusy}>⏹ Close it…</button>
            )}
            {status === "CLOSED" && (
              <button type="button" className={secondary} onClick={() => askToSend("reopen")} disabled={anyBusy}>↩ Re-open it…</button>
            )}
            <button type="button" className={danger} onClick={() => { setNotice(null); setConfirm("delete") }} disabled={anyBusy}>🗑 Delete…</button>
          </div>
        </div>

        {notice && (
          <p role={notice.tone === "bad" ? "alert" : "status"}
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${notice.tone === "good"
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"}`}>
            {notice.text}
          </p>
        )}

        {(confirm === "open" || confirm === "reopen") && (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700/60 dark:bg-emerald-950/40">
            <p className="font-semibold text-emerald-950 dark:text-emerald-50">
              {confirm === "open" ? "Send" : "Re-open"} this survey to {reached} {reached === 1 ? "person" : "people"}?
            </p>
            <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-100">
              {confirm === "open"
                ? "It pops up straight away for anyone using the Hub, and for everyone else the next time they open it. They can answer there and then or press \"Fill it out later\"."
                : "Anyone in the audience who hasn't answered gets the popup again — or their top-bar button back, if they'd said later."}{" "}
              The popup tells them their name is attached to their answers.
              {dirty ? " Your unsaved changes will be saved first." : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={primary} onClick={() => doSend(confirm)} disabled={anyBusy}>
                {busy === "open" || busy === "reopen"
                  ? <><Spinner /> {dirty ? "Saving, then sending…" : "Sending…"}</>
                  : `✓ Yes — ${confirm === "open" ? "send" : "re-open"} it for ${reached} ${reached === 1 ? "person" : "people"}`}
              </button>
              <button type="button" className={secondary} onClick={() => setConfirm(null)} disabled={anyBusy}>Cancel</button>
            </div>
          </div>
        )}

        {confirm === "close" && (
          <div className="mt-3 rounded-xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-800/60">
            <p className="font-semibold text-gray-900 dark:text-white">Close this survey?</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              The popup stops appearing{counts.later > 0 ? `, and the "fill it out later" button disappears from the ${counts.later} ${counts.later === 1 ? "person" : "people"} who put it off` : ""}.
              {counts.later > 0 ? " Whatever they'd typed but not submitted won't reach you." : ""} Every answer already given is kept, and you can re-open it later.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={primary} onClick={doClose} disabled={anyBusy}>
                {busy === "close" ? <><Spinner /> Closing…</> : "✓ Yes — close it"}
              </button>
              <button type="button" className={secondary} onClick={() => setConfirm(null)} disabled={anyBusy}>Cancel</button>
            </div>
          </div>
        )}

        {confirm === "delete" && (
          <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-700/70 dark:bg-red-950/40">
            <p className="font-semibold text-red-900 dark:text-red-100">Delete this survey for good?</p>
            <p className="mt-1 text-sm text-red-800 dark:text-red-200">
              {answeredTotal > 0
                ? `⚠ It has answers from ${answeredTotal} ${answeredTotal === 1 ? "person" : "people"} — they are deleted with it and can't be got back. `
                : "Nobody has answered it. "}
              {laterCount > 0 ? `${laterCount} ${laterCount === 1 ? "person has" : "people have"} put it off; their unfinished answers go too. ` : ""}
              {status === "OPEN" ? "The popup and the top-bar buttons disappear from everyone's screens. " : ""}
              This can&apos;t be undone.
            </p>
            {answeredTotal > 0 && (
              <div className="mt-3">
                <ExportButton
                  surveyId={survey.id}
                  label="⬇ Export the answers to Excel first"
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-300 px-4 font-semibold text-red-900 hover:bg-red-100 disabled:opacity-60 dark:border-red-700/70 dark:text-red-100 dark:hover:bg-red-900/40"
                />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={dangerSolid} onClick={doDelete} disabled={anyBusy}>
                {busy === "delete"
                  ? <><Spinner /> Deleting…</>
                  : answeredTotal > 0 ? `Yes — delete it and its ${answeredTotal} ${answeredTotal === 1 ? "answer" : "answers"}` : "Yes — delete it"}
              </button>
              <button type="button" className={secondary} onClick={() => setConfirm(null)} disabled={anyBusy}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {/* ── Heading and message ─────────────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">The popup&apos;s heading and message</h2>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Title</span>
              <input value={title} onChange={e => setTitle(e.target.value.slice(0, 150))} className={input} placeholder="e.g. Hub feedback — September" />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Short message at the top (optional)</span>
              <AutoTextarea
                value={intro}
                onChange={e => setIntro(e.target.value.slice(0, 1500))}
                className={`${input} min-h-[5rem] resize-none`}
                placeholder="e.g. We'd like to know how the Hub is working for you. It takes about five minutes — thank you!"
              />
            </label>
          </section>

          {/* ── Questions ───────────────────────────────────────────────────── */}
          <section className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Questions</h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">{questions.length} of {MAX_QUESTIONS} · written answers</span>
            </div>

            {status === "OPEN" && (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-100">
                <strong>This survey is out with people.</strong> You can still change it, and saved changes apply from then on:
                answers already given keep the wording they were answered with. People who have already answered won&apos;t be
                asked a question you add now. Removing a question also drops whatever anyone who said later had typed for it.
                Anyone you add to the audience gets it the next time their Hub checks for surveys.
              </div>
            )}
            {status === "CLOSED" && (
              <div className="mt-3 rounded-xl border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                This survey is closed, so changes only matter if you re-open it. Answers already given keep their original wording.
              </div>
            )}

            {questions.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">No questions yet — type one below, or let ✨ AI suggest some.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {questions.map((q, i) => {
                  const len = q.text.length
                  const feature = clean(q.text) === FEATURE_QUESTION_TEXT
                  return (
                    <li key={q.id} className="flex items-start gap-2">
                      <span className="mt-2.5 w-7 shrink-0 text-right text-sm font-semibold text-gray-500 dark:text-gray-400">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <AutoTextarea
                          value={q.text}
                          maxLength={MAX_QUESTION_CHARS}
                          onChange={e => {
                            const v = e.target.value
                            setQuestions(prev => prev.map(x => (x.id === q.id ? { ...x, text: v } : x)))
                          }}
                          className={`${input} resize-none ${clean(q.text) ? "" : "border-amber-400 dark:border-amber-500/70"}`}
                          aria-label={`Question ${i + 1}`}
                        />
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                          {feature && <span className="text-violet-700 dark:text-violet-300">★ The feature-request question</span>}
                          {!clean(q.text) && <span className="text-amber-700 dark:text-amber-400">Empty — it will be left out when you save.</span>}
                          {len > MAX_QUESTION_CHARS * 0.8 && (
                            <span className={len >= MAX_QUESTION_CHARS ? "text-amber-700 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}>
                              {len} / {MAX_QUESTION_CHARS} characters
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button type="button" className={iconBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`}>↑</button>
                        <button type="button" className={iconBtn} onClick={() => move(i, 1)} disabled={i === questions.length - 1} aria-label={`Move question ${i + 1} down`}>↓</button>
                        <button type="button" className={`${iconBtn} text-red-600 dark:text-red-400`} onClick={() => remove(i)} aria-label={`Remove question ${i + 1}`}>🗑</button>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}

            {removed && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <span className="min-w-0 flex-1 truncate">Removed “{removed.q.text || "(empty question)"}”</span>
                <button type="button" className={secondary} onClick={undoRemove} disabled={questions.length >= MAX_QUESTIONS}>↩ Undo</button>
              </div>
            )}

            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Add your own question</span>
                <AutoTextarea
                  value={newText}
                  maxLength={MAX_QUESTION_CHARS}
                  onChange={e => setNewText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addTyped() } }}
                  className={`${input} resize-none`}
                  placeholder="e.g. Which part of the lot wizard slows you down the most?"
                  disabled={room <= 0}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" className={primary} onClick={addTyped} disabled={!clean(newText) || room <= 0}>＋ Add question</button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {room <= 0
                    ? `That's the most a survey can have (${MAX_QUESTIONS}).`
                    : "New questions go in above the feature-request question, which stays last. Use the arrows to move anything."}
                </span>
              </div>
            </div>
          </section>

          <AiSuggest existing={questions.map(q => q.text)} room={room} onAdd={addQuestions} />
        </div>

        <div className="space-y-6">
          <AudiencePicker
            roles={roles}
            users={users}
            selectedRoles={roleSel}
            selectedUserIds={userSel}
            onRoles={setRoleSel}
            onUsers={setUserSel}
          />
        </div>
      </div>

      {/* Always in reach while editing a long survey on a tablet. */}
      {dirty && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur dark:border-amber-600/60 dark:bg-amber-950/90">
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">You have unsaved changes.</span>
          <button type="button" className={primary} onClick={onSave} disabled={anyBusy}>
            {busy === "save" ? <><Spinner /> Saving…</> : "💾 Save changes"}
          </button>
        </div>
      )}

      {preview && (
        <FeedbackForm
          mode="preview"
          survey={{ title: clean(title) || "(no title yet)", intro: intro.trim() || null, questions: usable.map(q => ({ id: q.id, text: clean(q.text) })) }}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  )
}
