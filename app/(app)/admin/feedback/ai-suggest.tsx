"use client"

import { useEffect, useRef, useState } from "react"
import { MAX_QUESTION_CHARS, MAX_QUESTIONS } from "@/lib/feedback-types"
import { Spinner, TickBox } from "./feedback-shared"

// ✨ Suggest questions with AI — Jordan: "the option to get AI to make up some questions and then
// the ability to change and add my own".
//
// The suggestions come back as a TICKED list he can untick or reword before anything touches the
// survey; nothing is added until he presses "Add the ticked ones". The questions already in the
// survey (and any suggestions still on screen) are sent as `existing` so it doesn't repeat them.
//
// ⚠ One request, so the honest progress is the seconds ticking by (RULES.md 7b), with a Stop —
// the AI can take a while, and a frozen "Thinking…" reads as a hang. Errors say what went wrong
// in words; an empty answer is an error, never a silent "nothing to add".

const TIMEOUT_MS = 120_000
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

type Item = { key: string; text: string; ticked: boolean }

export default function AiSuggest({ existing, room, onAdd }: {
  /** The survey's current questions — sent so the AI doesn't repeat them. */
  existing: string[]
  /** How many more questions the survey can take (MAX_QUESTIONS minus what's there). */
  room: number
  onAdd: (texts: string[]) => void
}) {
  const [focus, setFocus] = useState("")
  const [count, setCount] = useState(6)
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])

  // Leaving the page mid-request shouldn't leave a fetch running for nobody.
  useEffect(() => () => abortRef.current?.abort(), [])

  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000))
  const existingNorm = new Set(existing.map(norm))

  async function suggest() {
    setError(null)
    setResult(null)
    const started = Date.now()
    setStartedAt(started)
    setNow(started)
    setRunning(true)
    stoppedRef.current = false
    const ac = new AbortController()
    abortRef.current = ac
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    try {
      const res = await fetch("/api/admin/feedback/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focus: focus.trim() || undefined,
          count,
          existing: [...existing, ...items.map(i => i.text)].map(s => s.trim()).filter(Boolean),
        }),
        signal: ac.signal,
      })
      const data = (await res.json().catch(() => null)) as { questions?: unknown; error?: unknown } | null
      if (!res.ok || !data || !Array.isArray(data.questions)) {
        setError(
          data && typeof data.error === "string" && data.error
            ? data.error
            : `The Hub's server answered with an error (${res.status}) and no questions. Try again in a minute.`,
        )
        return
      }
      const seen = new Set([...existing, ...items.map(i => i.text)].map(norm))
      const fresh: string[] = []
      for (const q of data.questions) {
        const text = String(q ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS)
        if (!text || seen.has(norm(text))) continue
        seen.add(norm(text))
        fresh.push(text)
      }
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000))
      if (data.questions.length === 0) {
        setError("The AI came back with no questions. Try again, or word the focus differently.")
        return
      }
      if (fresh.length === 0) {
        setError(`The AI came back with ${data.questions.length} question${data.questions.length === 1 ? "" : "s"}, but every one repeated a question you already have. Try a different focus.`)
        return
      }
      setItems(prev => [...prev, ...fresh.map((text, i) => ({ key: `${started}-${i}`, text, ticked: true }))])
      const dropped = data.questions.length - fresh.length
      setResult(
        `Asked for ${count}, got ${fresh.length} new question${fresh.length === 1 ? "" : "s"} in ${secs}s` +
          (dropped > 0 ? ` (${dropped} left out for repeating one you already have)` : "") +
          ". Untick any you don't want or change the wording, then add them.",
      )
    } catch (e) {
      if (stoppedRef.current) setError("Stopped. Nothing was added.")
      else if ((e as { name?: string })?.name === "AbortError") setError("No answer after 2 minutes, so it was stopped. Try again — the AI is sometimes busy.")
      else setError("Couldn't reach the Hub's server — check the connection and try again.")
    } finally {
      clearTimeout(timer)
      abortRef.current = null
      setRunning(false)
    }
  }

  function stop() {
    stoppedRef.current = true
    abortRef.current?.abort()
  }

  function addTicked() {
    const ticked = items.filter(i => i.ticked && i.text.trim())
    if (ticked.length === 0) return
    const take = ticked.slice(0, Math.max(0, room))
    if (take.length === 0) {
      setError(`The survey already has ${MAX_QUESTIONS} questions — that's the most it can take. Remove one to make room.`)
      return
    }
    onAdd(take.map(t => t.text.replace(/\s+/g, " ").trim()))
    const taken = new Set(take.map(t => t.key))
    setItems(prev => prev.filter(i => !taken.has(i.key)))
    setError(null)
    setResult(
      `Added ${take.length} question${take.length === 1 ? "" : "s"} to the survey.` +
        (take.length < ticked.length ? ` ${ticked.length - take.length} didn't fit — a survey can have ${MAX_QUESTIONS} questions.` : "") +
        " Remember to save.",
    )
  }

  const tickedCount = items.filter(i => i.ticked && i.text.trim()).length
  const input = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500"
  const stepBtn = "flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 text-lg font-bold text-gray-800 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"

  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4 dark:border-violet-800/60 dark:bg-gray-900 md:p-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">✨ Suggest questions with AI</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Optional. The AI writes some questions; you choose which to keep and can change any of them first.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">What should they be about? (optional)</span>
          <input
            value={focus}
            onChange={e => setFocus(e.target.value.slice(0, 300))}
            placeholder="e.g. the lot wizard and photo uploads"
            className={input}
            disabled={running}
          />
        </label>
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">How many</span>
          <div className="flex items-center gap-2">
            <button type="button" className={stepBtn} onClick={() => setCount(c => Math.max(1, c - 1))} disabled={running || count <= 1} aria-label="Fewer">−</button>
            <span className="w-8 text-center text-lg font-semibold text-gray-900 dark:text-white" aria-live="polite">{count}</span>
            <button type="button" className={stepBtn} onClick={() => setCount(c => Math.min(10, c + 1))} disabled={running || count >= 10} aria-label="More">+</button>
          </div>
        </div>
        {running ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-100 px-4 font-semibold text-violet-900 dark:bg-violet-500/15 dark:text-violet-200">
              <Spinner /> Writing questions… {elapsed}s
            </span>
            <button type="button" onClick={stop} className="min-h-11 rounded-xl border border-gray-300 px-4 font-semibold text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800">
              Stop
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={suggest}
            className="min-h-11 rounded-xl bg-violet-600 px-5 font-semibold text-white hover:bg-violet-500"
          >
            {items.length ? "✨ Suggest more" : "✨ Suggest questions"}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && !error && <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{result}</p>}

      {items.length > 0 && (
        <div className="mt-4">
          <div className="space-y-2">
            {items.map(item => {
              const dup = existingNorm.has(norm(item.text))
              return (
                <div key={item.key} className="flex items-start gap-2">
                  <div className="w-11 shrink-0">
                    <TickBox
                      ticked={item.ticked}
                      onToggle={() => setItems(prev => prev.map(i => (i.key === item.key ? { ...i, ticked: !i.ticked } : i)))}
                      className="justify-center px-0"
                    >
                      <span className="sr-only">{item.ticked ? "Ticked — will be added" : "Not ticked"}</span>
                    </TickBox>
                  </div>
                  <div className="min-w-0 flex-1">
                    <textarea
                      value={item.text}
                      rows={2}
                      maxLength={MAX_QUESTION_CHARS}
                      onChange={e => {
                        const v = e.target.value
                        setItems(prev => prev.map(i => (i.key === item.key ? { ...i, text: v } : i)))
                      }}
                      className={`${input} resize-y ${item.ticked ? "" : "opacity-60"}`}
                      aria-label="Suggested question"
                    />
                    {dup && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">⚠ The survey already has this question.</p>}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addTicked}
              disabled={tickedCount === 0 || running}
              className="min-h-11 rounded-xl bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              ＋ Add the ticked ones ({tickedCount})
            </button>
            <button
              type="button"
              onClick={() => { setItems([]); setResult(null); setError(null) }}
              disabled={running}
              className="min-h-11 rounded-xl border border-gray-300 px-4 font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              Clear the suggestions
            </button>
            {tickedCount > room && (
              <span className="text-sm text-amber-700 dark:text-amber-400">
                Only {Math.max(0, room)} more {room === 1 ? "fits" : "fit"} — a survey can have {MAX_QUESTIONS} questions.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
