"use client"

// 📝 The Hub feedback survey form — ONE component for both the real popup on the tablets
// (components/feedback-prompt.tsx) and the admin's Preview on /admin/feedback, so what Jordan
// previews is exactly what the cataloguers get.
//
// It renders its own full-screen overlay, portalled to <body> (so no ancestor's transform or
// backdrop-filter can trap a `position: fixed` child), carrying `data-hub-popup` so other popups
// can tell one is already on screen.
//
// Live mode has NO close ✕, on purpose: "Submit" and "Fill it out later" are the two choices. A ✕
// would be a third that quietly does neither, and the survey would simply pop up again on the next
// page load. Preview mode has a ✕, and its two buttons only say what they would have done.
//
// ⚠ iPad + on-screen keyboard. iOS does NOT shrink a `position: fixed; inset: 0` box when the
// keyboard opens — the layout viewport stays full height and the keyboard slides over its bottom,
// which is exactly where the buttons are. So the overlay is sized to window.visualViewport (the
// part of the screen actually visible) and the questions scroll inside the card, keeping the
// title and the two buttons in view whatever is typed.
//
// ⚠ Every answer box uses a 16px font (text-base). iOS zooms the whole page when a field under
// 16px is focused, and on a fixed modal that zoom pushes the buttons off the screen.

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { TextareaHTMLAttributes } from "react"
import { createPortal } from "react-dom"
import type { FeedbackQuestion } from "@/lib/feedback-types"
import { MAX_ANSWER_CHARS } from "@/lib/feedback-types"

type Props = {
  survey: { title: string; intro: string | null; questions: FeedbackQuestion[] }
  initialAnswers?: Record<string, string>
  mode: "live" | "preview"
  busy?: boolean
  error?: string | null
  onSubmit?: (answers: Record<string, string>) => void
  onLater?: (answers: Record<string, string>) => void
  /** Preview mode's close button (and Escape). Live mode has no close. */
  onClose?: () => void
}

/** The character count only appears this close to the limit — a counter under every box reads
 *  like a target to hit, and almost nobody gets near 5,000 characters. */
const COUNT_FROM = Math.floor(MAX_ANSWER_CHARS * 0.8)

// ⚠ Word for word the same as the server's refusal in app/api/feedback/respond/route.ts. The form
// checks first so nobody waits on a round trip to be told, but the server is the rule.
const NEED_ONE_ANSWER = "Please answer at least one question, or press Fill it out later"

const noSubscribe = () => () => {}

export default function FeedbackForm({
  survey, initialAnswers, mode, busy = false, error = null, onSubmit, onLater, onClose,
}: Props) {
  // False on the server and during hydration, true in the browser — createPortal needs a document.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false)
  const preview = mode === "preview"
  const uid = useId()
  const titleId = `${uid}-title`

  // Held here, not in the parent: while this stays mounted nothing typed can be lost, whatever
  // happens to a save. The parent remounts it (key) only for a different survey.
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...(initialAnswers ?? {}) }))
  const [localError, setLocalError] = useState<string | null>(null)
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [pressed, setPressed] = useState<"submit" | "later" | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const box = useVisibleBox()

  // Take focus off whatever was behind the popup. It can appear while someone is mid-way through
  // a lot, and without this their next keystrokes would carry on into the page underneath.
  useEffect(() => {
    if (inBrowser) cardRef.current?.focus({ preventScroll: true })
  }, [inBrowser])

  // The keyboard opening shrinks the box — bring the answer being typed back into view.
  useEffect(() => {
    const el = document.activeElement
    if (el instanceof HTMLTextAreaElement && scrollRef.current?.contains(el)) el.scrollIntoView({ block: "nearest" })
  }, [box])

  // Escape closes a preview. Live mode ignores it (see the note at the top). This listener only
  // hears it when focus is OUTSIDE the popup (a tap on the backdrop); inside, onKeyDown handles it.
  useEffect(() => {
    if (!preview || !onClose) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [preview, onClose])

  if (!inBrowser) return null

  const questions = survey.questions
  const answered = questions.filter(q => (answers[q.id] ?? "").trim()).length
  const shownError = localError ?? error

  function press(which: "submit" | "later") {
    if (busy) return
    setLocalError(null)
    setPreviewNote(null)
    if (which === "submit" && answered === 0) {
      setLocalError(NEED_ONE_ANSWER)
      return
    }
    if (preview) {
      setPreviewNote(
        which === "submit"
          ? "Preview only — nothing was sent. In the real popup this sends the answers with the person's name, and they won't be asked again."
          : "Preview only — nothing was saved. In the real popup this keeps what they've typed and puts a “📝 Feedback to finish” button in their top bar until they send it.",
      )
      return
    }
    setPressed(which)
    const given = Object.fromEntries(questions.map(q => [q.id, answers[q.id] ?? ""]))
    if (which === "submit") onSubmit?.(given)
    else onLater?.(given)
  }

  return createPortal(
    <div
      data-hub-popup={preview ? "feedback-preview" : "feedback"}
      // z-10000: above the tablet cataloguing screen, which is itself a fixed overlay at 9999 —
      // anything lower is invisible on exactly the iPads this is for.
      className="fixed inset-x-0 z-[10000] flex items-center justify-center bg-black/70 p-2 sm:p-6"
      style={box ? { top: box.top, height: box.height } : { top: 0, bottom: 0 }}
      // ⚠ Keys typed in here must not reach the page underneath. Some pages act on bare keys from
      // a window listener without looking at where the typing is — the training and induction
      // presenters ("n" notes, "f" full screen, arrows change slide), the accounts viewer and the
      // photo viewer (+ / − / 0 zoom) — so an answer typed over them would drive the page. The
      // answer boxes still get every character: their onChange runs off the input event, not keys.
      onKeyDown={e => {
        e.stopPropagation()
        // Stopped here, so the window Escape listener below can't see it — close the preview now.
        if (preview && onClose && e.key === "Escape") onClose()
      }}
      onKeyUp={e => e.stopPropagation()}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-gray-800 dark:bg-[#1C1C1E]"
      >
        {/* Header — stays put while the questions scroll. */}
        <div className="flex flex-shrink-0 items-start gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              <span>📝 Hub feedback</span>
              {preview && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] normal-case tracking-normal text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  Preview — nothing is saved
                </span>
              )}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-bold leading-snug text-gray-900 dark:text-white sm:text-xl">
              {survey.title.trim() || "Hub feedback"}
            </h2>
            {/* Jordan's decision: answers are NAMED, and people must be told so up front. */}
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
              <span aria-hidden>👤</span>
              Your name is attached to your answers
            </p>
          </div>
          {preview && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the preview"
              title="Close the preview"
              className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* The only part that scrolls. overscroll-contain: a flick at the end of the list must not
            scroll the page behind the popup instead. */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
          {survey.intro?.trim() && (
            <p className="whitespace-pre-wrap text-base leading-relaxed text-gray-700 dark:text-gray-300">{survey.intro.trim()}</p>
          )}

          {questions.length === 0 ? (
            <p className="text-sm italic text-gray-500 dark:text-gray-400">There are no questions in this survey yet.</p>
          ) : (
            questions.map((q, i) => {
              const value = answers[q.id] ?? ""
              const fieldId = `${uid}-q-${q.id}`
              return (
                <div key={q.id}>
                  <label htmlFor={fieldId} className="block text-base font-semibold leading-snug text-gray-900 dark:text-white">
                    <span className="mr-1.5 text-gray-400 dark:text-gray-500">{i + 1}.</span>
                    {q.text}
                  </label>
                  <GrowingTextarea
                    id={fieldId}
                    value={value}
                    onChange={e => {
                      const text = e.target.value
                      setAnswers(a => ({ ...a, [q.id]: text }))
                      if (localError) setLocalError(null)
                    }}
                    // readOnly, not disabled, while saving: disabling a focused box on iOS drops the
                    // keyboard and can lose the caret — and nothing here needs to be locked out.
                    readOnly={busy}
                    maxLength={MAX_ANSWER_CHARS}
                    placeholder="Type your answer here…"
                    className="mt-2 block min-h-[104px] w-full resize-none rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-base leading-relaxed text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] dark:border-gray-700 dark:bg-[#2C2C2E] dark:text-white dark:placeholder-gray-500"
                  />
                  {value.length >= COUNT_FROM && (
                    <p
                      className={`mt-1 text-right text-xs ${
                        value.length >= MAX_ANSWER_CHARS ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {value.length.toLocaleString("en-GB")} / {MAX_ANSWER_CHARS.toLocaleString("en-GB")} characters
                      {value.length >= MAX_ANSWER_CHARS && " — that's the most one answer can hold"}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer — the two choices, always reachable. */}
        <div className="flex-shrink-0 space-y-2.5 border-t border-gray-200 px-5 py-3.5 dark:border-gray-800">
          {shownError && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              {shownError}
            </p>
          )}
          {previewNote && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {previewNote}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
            <p className="text-center text-xs text-gray-500 dark:text-gray-400 sm:mr-auto sm:text-left">
              {answered} of {questions.length} answered
            </p>
            <button
              type="button"
              onClick={() => press("later")}
              disabled={busy}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 text-base font-semibold text-gray-800 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 dark:border-gray-600 dark:bg-transparent dark:text-gray-100 dark:hover:bg-gray-800"
            >
              {busy && pressed === "later" ? <><Spinner /> Saving…</> : "Fill it out later"}
            </button>
            <button
              type="button"
              onClick={() => press("submit")}
              disabled={busy}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#2AB4A6] px-7 text-base font-semibold text-white transition-colors hover:bg-[#24a090] disabled:cursor-wait disabled:opacity-60"
            >
              {busy && pressed === "submit" ? <><Spinner /> Sending…</> : "Submit"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The part of the screen actually visible — shrinks when the iPad's keyboard is up (see the
 *  note at the top). Null where the browser can't say, or while pinch-zoomed (sizing to a zoomed
 *  view would shrink the card to a sliver), and the overlay then simply fills the window. */
function useVisibleBox(): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      if (Math.abs(vv.scale - 1) > 0.01) setBox(null)
      else setBox({ top: vv.offsetTop, height: vv.height })
    }
    // queueMicrotask: the react-compiler lint rule bans a synchronous setState inside an effect.
    queueMicrotask(update)
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [])
  return box
}

/** A textarea that grows with what's typed, so a long answer never hides inside a tiny box with
 *  its own scrollbar (fiddly with a finger). The card scrolls instead. */
function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const { value } = props

  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current
      if (!el) return
      el.style.height = "auto"
      // + the 2px of border: scrollHeight counts padding but not border (box-sizing: border-box).
      el.style.height = `${el.scrollHeight + 2}px`
    }
    fit()
    // Turning the iPad round rewraps every line.
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [value])

  return <textarea ref={ref} rows={3} {...props} />
}

function Spinner() {
  return <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
}
