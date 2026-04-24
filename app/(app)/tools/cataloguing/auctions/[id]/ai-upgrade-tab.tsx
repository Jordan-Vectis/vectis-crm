"use client"

import { useState, useEffect, useRef } from "react"
import { applyAiDescriptions } from "@/lib/actions/catalogue"
import { PRESETS } from "@/lib/auction-ai-presets"

interface Lot {
  id: string
  lotNumber: string
  title: string
  keyPoints: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  imageUrls: string[]
  aiUpgraded: boolean
}

interface Props {
  auctionId: string
  lots: Lot[]
  onDone: () => void
}

type Phase = "idle" | "fetching" | "running" | "review" | "saving" | "done"

interface LotResult {
  lotId:          string
  lotNumber:      string
  oldDescription: string
  oldEstimateLow: number | null
  oldEstimateHigh: number | null
  newDescription: string
  newEstimateLow: number | null
  newEstimateHigh: number | null
  newEstimateRaw: string
  status:         "ok" | "failed" | "skipped"
  error?:         string
  approved:       boolean
}

function parseEstimate(est: string): { low: number | null; high: number | null } {
  const m = est.match(/£([\d,]+)\s*[–\-]\s*£([\d,]+)/)
  if (!m) return { low: null, high: null }
  return {
    low:  parseInt(m[1].replace(/,/g, ""), 10),
    high: parseInt(m[2].replace(/,/g, ""), 10),
  }
}

const DEFAULT_MODEL = "gemini-3-flash-preview"
const PRESET_KEYS   = Object.keys(PRESETS).filter(k => k !== "Custom (paste my own)")

export default function AiUpgradeTab({ auctionId, lots, onDone }: Props) {
  const [phase,        setPhase]        = useState<Phase>("idle")
  const [preset,       setPreset]       = useState(PRESET_KEYS[0] ?? "")
  const [model,        setModel]        = useState(DEFAULT_MODEL)
  const [modelList,    setModelList]    = useState<string[]>([DEFAULT_MODEL])
  const [sendDesc,     setSendDesc]     = useState(true)
  const [contextField, setContextField] = useState<"keyPoints" | "description">("keyPoints")
  const [selectedLotIds, setSelectedLotIds] = useState<Set<string>>(
    () => new Set(lots.filter(l => !l.aiUpgraded && l.imageUrls.length > 0).map(l => l.id))
  )
  const [results,      setResults]      = useState<LotResult[]>([])
  const [fetchProgress, setFetchProgress] = useState({ done: 0, total: 0 })
  const [runProgress,   setRunProgress]   = useState({ done: 0, total: 0 })
  const [saveProgress,  setSaveProgress]  = useState({ done: 0, total: 0 })
  const [log,          setLog]          = useState<string[]>([])
  const [error,        setError]        = useState<string | null>(null)
  const [paused,       setPaused]       = useState(false)
  const cancelRef = useRef(false)
  const pauseRef  = useRef(false)
  const logRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
  }, [])

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  function handlePause() {
    pauseRef.current = true
    setPaused(true)
    addLog("⏸ Paused — will stop after current lot finishes")
  }

  function handleResume() {
    pauseRef.current = false
    setPaused(false)
    addLog("▶ Resuming…")
  }

  function handleCancel() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
  }

  // Wait while paused (called inside the run loop)
  async function waitIfPaused() {
    while (pauseRef.current && !cancelRef.current) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  function toggleLot(id: string) {
    setSelectedLotIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function quickSelect(ids: string[]) {
    setSelectedLotIds(new Set(ids))
  }

  const eligibleLots = lots.filter(l => selectedLotIds.has(l.id))

  async function start() {
    if (eligibleLots.length === 0) { setError("No lots match the selected filter."); return }
    setError(null)
    cancelRef.current = false
    pauseRef.current  = false
    setPaused(false)
    setLog([])
    setResults([])

    // ── Phase 1: Fetch photos from R2 ──────────────────────────────────────
    setPhase("fetching")
    const photoMap: Record<string, Blob[]> = {}
    const total = eligibleLots.reduce((s, l) => s + l.imageUrls.length, 0)
    setFetchProgress({ done: 0, total })
    addLog(`Fetching photos for ${eligibleLots.length} lots (${total} images)…`)

    let fetched = 0
    for (const lot of eligibleLots) {
      if (cancelRef.current) break
      photoMap[lot.id] = []
      for (const key of lot.imageUrls) {
        if (cancelRef.current) break
        try {
          const res = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`)
          if (res.ok) {
            const blob = await res.blob()
            photoMap[lot.id].push(blob)
          }
        } catch { /* skip failed photos */ }
        fetched++
        setFetchProgress({ done: fetched, total })
      }
    }

    if (cancelRef.current) { setPhase("idle"); return }
    addLog(`Photos ready. Starting AI processing…`)

    // ── Phase 2: Run AI lot by lot ──────────────────────────────────────────
    setPhase("running")
    const runTotal = eligibleLots.length
    setRunProgress({ done: 0, total: runTotal })

    const systemInstruction = PRESETS[preset] ?? ""
    const collected: LotResult[] = []

    for (let i = 0; i < eligibleLots.length; i++) {
      // Respect pause before starting each lot
      await waitIfPaused()
      if (cancelRef.current) { addLog(`⛔ Cancelled after ${i} lots`); break }

      const lot    = eligibleLots[i]
      const photos = photoMap[lot.id] ?? []
      addLog(`Processing ${i + 1}/${runTotal} — Lot ${lot.lotNumber} (${photos.length} photo${photos.length !== 1 ? "s" : ""})`)

      try {
        const fd = new FormData()
        fd.set("systemInstruction", systemInstruction)
        fd.set("model", model)
        photos.forEach((blob, j) => {
          fd.append(`lot_${lot.lotNumber}_image_${j}`, blob, `photo_${j}.jpg`)
        })
        if (sendDesc) {
          const ctx = contextField === "description" ? lot.description : lot.keyPoints
          if (ctx.trim()) fd.set(`lot_${lot.lotNumber}_context`, ctx.trim())
        }

        const res  = await fetch("/api/auction-ai/batch", { method: "POST", body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? res.statusText)

        const r = json.results?.[0]
        if (!r || r.status !== "OK") throw new Error(r?.error ?? "No result")

        const { low, high } = parseEstimate(r.estimate)
        collected.push({
          lotId:           lot.id,
          lotNumber:       lot.lotNumber,
          oldDescription:  lot.keyPoints,
          oldEstimateLow:  lot.estimateLow,
          oldEstimateHigh: lot.estimateHigh,
          newDescription:  r.description,
          newEstimateLow:  low,
          newEstimateHigh: high,
          newEstimateRaw:  r.estimate,
          status:          "ok",
          approved:        true,
        })
        addLog(`✓ Lot ${lot.lotNumber} — done`)
      } catch (e: any) {
        collected.push({
          lotId:           lot.id,
          lotNumber:       lot.lotNumber,
          oldDescription:  lot.keyPoints,
          oldEstimateLow:  lot.estimateLow,
          oldEstimateHigh: lot.estimateHigh,
          newDescription:  "",
          newEstimateLow:  null,
          newEstimateHigh: null,
          newEstimateRaw:  "",
          status:          "failed",
          error:           e.message,
          approved:        false,
        })
        addLog(`✗ Lot ${lot.lotNumber} — failed: ${e.message}`)
      }

      setResults([...collected])
      setRunProgress({ done: i + 1, total: runTotal })

      // 8s rate-limit gap — split into small chunks so pause/cancel responds quickly
      if (i < eligibleLots.length - 1 && !cancelRef.current) {
        for (let t = 0; t < 80; t++) {
          if (cancelRef.current) break
          await new Promise(r => setTimeout(r, 100))
        }
        await waitIfPaused()
      }
    }

    setPhase("review")
  }

  function toggleApprove(lotId: string) {
    setResults(prev => prev.map(r => r.lotId === lotId ? { ...r, approved: !r.approved } : r))
  }
  function approveAll()  { setResults(prev => prev.map(r => r.status === "ok" ? { ...r, approved: true }  : r)) }
  function rejectAll()   { setResults(prev => prev.map(r => ({ ...r, approved: false })) ) }

  async function applyApproved() {
    const toApply = results.filter(r => r.approved && r.status === "ok")
    if (toApply.length === 0) { setError("No approved lots to apply."); return }
    setError(null)
    setSaveProgress({ done: 0, total: toApply.length })
    setPhase("saving")

    await applyAiDescriptions(auctionId, toApply.map(r => ({
      id:           r.lotId,
      description:  r.newDescription,
      estimateLow:  r.newEstimateLow,
      estimateHigh: r.newEstimateHigh,
    })))

    setSaveProgress({ done: toApply.length, total: toApply.length })
    setPhase("done")
    onDone()
  }

  const approvedCount = results.filter(r => r.approved && r.status === "ok").length
  const failedCount   = results.filter(r => r.status === "failed").length
  const okCount       = results.filter(r => r.status === "ok").length

  return (
    <div className="p-4 md:p-6 max-w-4xl">

      {/* ── Idle ── */}
      {phase === "idle" && (
        <div className="space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">AI Description Upgrade</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Select the lots to process, choose a preset and model, then run.
            </p>
          </div>

          {/* Preset */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">AI Instruction Preset</label>
            <select value={preset} onChange={e => setPreset(e.target.value)}
              className="w-full bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500">
              {PRESET_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500">
              {modelList.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Options */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={sendDesc} onChange={e => setSendDesc(e.target.checked)}
                className="w-4 h-4 rounded accent-purple-500" />
              <span className="text-sm text-gray-300">Send existing</span>
            </label>
            <select value={contextField} onChange={e => setContextField(e.target.value as "keyPoints" | "description")}
              disabled={!sendDesc}
              className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-40">
              <option value="keyPoints">Key Points</option>
              <option value="description">Description</option>
            </select>
            <span className="text-sm text-gray-300">to the AI</span>
            <span className="text-xs text-gray-600">(helps the AI refine rather than rewrite from scratch)</span>
          </div>

          {/* Lot selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Select lots</label>
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={() => quickSelect(lots.filter(l => !l.aiUpgraded && l.imageUrls.length > 0).map(l => l.id))}
                  className="text-xs text-gray-500 hover:text-purple-400 transition-colors">Not upgraded</button>
                <span className="text-gray-700 text-xs">·</span>
                <button onClick={() => quickSelect(lots.filter(l => l.imageUrls.length > 0).map(l => l.id))}
                  className="text-xs text-gray-500 hover:text-purple-400 transition-colors">Has photos</button>
                <span className="text-gray-700 text-xs">·</span>
                <button onClick={() => quickSelect(lots.map(l => l.id))}
                  className="text-xs text-gray-500 hover:text-purple-400 transition-colors">All</button>
                <span className="text-gray-700 text-xs">·</span>
                <button onClick={() => quickSelect([])}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors">None</button>
              </div>
            </div>

            <div className="border border-gray-700 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-[#111113] border-b border-gray-800">
                <input type="checkbox"
                  checked={lots.length > 0 && selectedLotIds.size === lots.length}
                  onChange={() => selectedLotIds.size === lots.length ? quickSelect([]) : quickSelect(lots.map(l => l.id))}
                  className="w-3.5 h-3.5 rounded accent-purple-500 flex-shrink-0" />
                <span className="text-xs text-gray-600 flex-1">
                  {selectedLotIds.size} of {lots.length} lots selected
                </span>
                <span className="text-xs text-gray-700 w-10 text-center">Photos</span>
                <span className="text-xs text-gray-700 w-6 text-center">AI</span>
              </div>

              {/* Lot rows */}
              <div className="max-h-56 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#4b5563 transparent" }}>
                {lots.map(lot => (
                  <label key={lot.id}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-800 last:border-0 transition-colors ${
                      selectedLotIds.has(lot.id) ? "bg-purple-900/10" : "hover:bg-[#1a1a1e]"
                    }`}>
                    <input type="checkbox" checked={selectedLotIds.has(lot.id)} onChange={() => toggleLot(lot.id)}
                      className="w-3.5 h-3.5 rounded accent-purple-500 flex-shrink-0" />
                    <span className="font-mono text-xs text-purple-300 w-14 flex-shrink-0">{lot.lotNumber}</span>
                    <span className="text-xs text-gray-300 flex-1 truncate">{lot.title || <span className="text-gray-600 italic">Untitled</span>}</span>
                    <span className="text-xs w-10 text-center">
                      {lot.imageUrls.length > 0
                        ? <span className="text-[#2AB4A6]">{lot.imageUrls.length}</span>
                        : <span className="text-gray-700">—</span>}
                    </span>
                    <span className="w-6 text-center text-xs">
                      {lot.aiUpgraded ? "✨" : <span className="text-gray-700">—</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <button onClick={start} disabled={eligibleLots.length === 0}
            className="w-full py-3 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
            ✨ Run AI on {eligibleLots.length} lot{eligibleLots.length !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      {/* ── Fetching photos ── */}
      {phase === "fetching" && (
        <ProgressCard
          title="Fetching photos…"
          subtitle={`${fetchProgress.done} / ${fetchProgress.total} images downloaded`}
          pct={fetchProgress.total > 0 ? (fetchProgress.done / fetchProgress.total) * 100 : 0}
          log={log} logRef={logRef}
          onCancel={handleCancel}
        />
      )}

      {/* ── Running AI ── */}
      {phase === "running" && (
        <ProgressCard
          title={paused ? "Paused" : "Running AI…"}
          subtitle={`${runProgress.done} / ${runProgress.total} lots processed`}
          pct={runProgress.total > 0 ? (runProgress.done / runProgress.total) * 100 : 0}
          log={log} logRef={logRef}
          onCancel={() => { handleCancel(); }}
          cancelLabel="Stop & review"
          onPause={paused ? undefined : handlePause}
          onResume={paused ? handleResume : undefined}
          onReviewNow={paused && results.filter(r => r.status === "ok").length > 0
            ? () => { handleCancel(); }
            : undefined}
          reviewNowCount={results.filter(r => r.status === "ok").length}
          paused={paused}
          liveResults={results}
        />
      )}

      {/* ── Review ── */}
      {phase === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Review AI Results</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {okCount} generated · {failedCount > 0 ? `${failedCount} failed · ` : ""}{approvedCount} approved
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={rejectAll}   className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 text-xs hover:border-gray-500 transition-colors">Deselect all</button>
              <button onClick={approveAll}  className="px-3 py-1.5 rounded-lg border border-purple-700/50 text-purple-300 text-xs hover:border-purple-500 transition-colors">Select all</button>
            </div>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {results.map(r => (
              <ReviewRow key={r.lotId} result={r} onToggle={() => toggleApprove(r.lotId)} />
            ))}
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setPhase("idle"); setResults([]) }}
              className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">
              ← Start over
            </button>
            <button onClick={applyApproved} disabled={approvedCount === 0}
              className="flex-1 py-2.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
              Apply {approvedCount} approved description{approvedCount !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Saving ── */}
      {phase === "saving" && (
        <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-6 py-10 flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-300 font-medium">Saving descriptions…</p>
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="bg-purple-900/10 border border-purple-700/30 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
            <span className="text-4xl">✓</span>
            <p className="text-sm font-semibold text-purple-300">Descriptions updated</p>
            <p className="text-xs text-gray-400">{approvedCount} lot{approvedCount !== 1 ? "s" : ""} updated with AI-generated descriptions</p>
          </div>
          <button onClick={() => { setPhase("idle"); setResults([]) }}
            className="w-full py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">
            Run again
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressCard({
  title, subtitle, pct, log, logRef, onCancel, cancelLabel, onPause, onResume, onReviewNow, reviewNowCount, paused, liveResults,
}: {
  title: string; subtitle: string; pct: number
  log: string[]; logRef: React.RefObject<HTMLDivElement | null>
  onCancel: () => void
  cancelLabel?: string
  onPause?: () => void
  onResume?: () => void
  onReviewNow?: () => void
  reviewNowCount?: number
  paused?: boolean
  liveResults?: { status: string; lotNumber: string }[]
}) {
  return (
    <div className="space-y-4">
      <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-6 py-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-300 font-medium">{title}</p>
          <div className="flex items-center gap-3">
            {onReviewNow && (
              <button onClick={onReviewNow}
                className="text-xs text-purple-400 hover:text-purple-300 font-medium transition-colors">
                Review {reviewNowCount} result{reviewNowCount !== 1 ? "s" : ""} →
              </button>
            )}
            {onResume && (
              <button onClick={onResume}
                className="text-xs text-green-400 hover:text-green-300 font-medium transition-colors">
                ▶ Resume
              </button>
            )}
            {onPause && (
              <button onClick={onPause}
                className="text-xs text-yellow-500 hover:text-yellow-400 font-medium transition-colors">
                ⏸ Pause
              </button>
            )}
            <button onClick={onCancel}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors">
              {cancelLabel ?? "Cancel"}
            </button>
          </div>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all duration-300 ${paused ? "bg-yellow-500" : "bg-purple-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 text-center">{subtitle}</p>
      </div>
      {log.length > 0 && (
        <div ref={logRef} className="bg-[#0d0d0f] border border-gray-800 rounded-xl p-4 h-40 overflow-y-auto font-mono text-xs text-gray-400 space-y-0.5">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

function ReviewRow({ result, onToggle }: { result: LotResult; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false)

  if (result.status === "failed") {
    return (
      <div className="bg-red-900/10 border border-red-800/40 rounded-xl px-4 py-3 flex items-center gap-3">
        <span className="font-mono text-xs text-red-400 w-16 flex-shrink-0">{result.lotNumber}</span>
        <span className="text-xs text-red-500 flex-1">Failed: {result.error}</span>
      </div>
    )
  }

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      result.approved ? "border-purple-700/50 bg-purple-900/10" : "border-gray-700 bg-[#1C1C1E]"
    }`}>
      {/* Compact header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" checked={result.approved} onChange={onToggle}
          className="accent-purple-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
        <span className="font-mono text-xs text-purple-300 w-16 flex-shrink-0">{result.lotNumber}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-300 truncate">{result.newDescription}</p>
          {result.newEstimateRaw && (
            <p className="text-xs text-gray-600 mt-0.5">
              {result.oldEstimateLow ? `£${result.oldEstimateLow}–£${result.oldEstimateHigh}` : "no estimate"} → <span className="text-purple-400">{result.newEstimateRaw}</span>
            </p>
          )}
        </div>
        <button onClick={() => setExpanded(x => !x)}
          className="text-xs text-gray-600 hover:text-gray-400 flex-shrink-0 px-2 py-1 rounded transition-colors">
          {expanded ? "▲ Less" : "▼ More"}
        </button>
      </div>

      {/* Expanded diff */}
      {expanded && (
        <div className="grid grid-cols-2 gap-0 border-t border-gray-800">
          <div className="p-4 border-r border-gray-800">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Current</p>
            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
              {result.oldDescription || <span className="italic text-gray-700">No description</span>}
            </p>
            {result.oldEstimateLow && (
              <p className="text-xs text-gray-600 mt-2">Estimate: £{result.oldEstimateLow}–£{result.oldEstimateHigh}</p>
            )}
          </div>
          <div className="p-4">
            <p className="text-xs text-purple-400 uppercase tracking-wider mb-2">AI Upgraded</p>
            <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{result.newDescription}</p>
            {result.newEstimateRaw && (
              <p className="text-xs text-purple-400 mt-2">Estimate: {result.newEstimateRaw}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
