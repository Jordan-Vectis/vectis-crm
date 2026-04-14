"use client"

import { useState, useEffect, useRef } from "react"
import { applyAiDescriptions } from "@/lib/actions/catalogue"
import { PRESETS } from "@/lib/auction-ai-presets"

interface Lot {
  id: string
  lotNumber: string
  title: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  imageUrls: string[]
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

const DEFAULT_MODEL = "gemini-2.5-flash-preview-04-17"
const PRESET_KEYS   = Object.keys(PRESETS).filter(k => k !== "Custom (paste my own)")

export default function AiUpgradeTab({ auctionId, lots, onDone }: Props) {
  const [phase,        setPhase]        = useState<Phase>("idle")
  const [preset,       setPreset]       = useState(PRESET_KEYS[0] ?? "")
  const [model,        setModel]        = useState(DEFAULT_MODEL)
  const [modelList,    setModelList]    = useState<string[]>([DEFAULT_MODEL])
  const [filter,       setFilter]       = useState<"all" | "photos" | "photos-and-desc">("photos")
  const [results,      setResults]      = useState<LotResult[]>([])
  const [fetchProgress, setFetchProgress] = useState({ done: 0, total: 0 })
  const [runProgress,   setRunProgress]   = useState({ done: 0, total: 0 })
  const [saveProgress,  setSaveProgress]  = useState({ done: 0, total: 0 })
  const [log,          setLog]          = useState<string[]>([])
  const [error,        setError]        = useState<string | null>(null)
  const cancelRef = useRef(false)
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

  // Eligible lots based on filter
  const eligibleLots = lots.filter(l => {
    if (filter === "photos")           return l.imageUrls.length > 0
    if (filter === "photos-and-desc")  return l.imageUrls.length > 0 && l.description.trim().length > 0
    return true // "all" — include even lots without photos (AI will do its best)
  })

  async function start() {
    if (eligibleLots.length === 0) { setError("No lots match the selected filter."); return }
    setError(null)
    cancelRef.current = false
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
        if (lot.description.trim()) {
          fd.set(`lot_${lot.lotNumber}_context`, lot.description.trim())
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
          oldDescription:  lot.description,
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
          oldDescription:  lot.description,
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

      // 8s rate-limit gap between lots (matches Gemini quota)
      if (i < eligibleLots.length - 1 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 8000))
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
              Automatically fetches photos from storage, runs them through AI, then lets you review and approve changes before overwriting.
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

          {/* Filter */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Which lots to process</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                ["photos",          "Lots with photos",              `${lots.filter(l => l.imageUrls.length > 0).length} lots`],
                ["photos-and-desc", "Lots with photos & description", `${lots.filter(l => l.imageUrls.length > 0 && l.description.trim()).length} lots`],
                ["all",             "All lots",                      `${lots.length} lots`],
              ] as const).map(([val, label, count]) => (
                <button key={val} onClick={() => setFilter(val)}
                  className={`flex flex-col items-center gap-0.5 py-3 px-2 rounded-xl border text-xs transition-colors ${
                    filter === val
                      ? "border-purple-500 bg-purple-900/20 text-purple-300"
                      : "border-gray-700 text-gray-500 hover:border-gray-500"
                  }`}>
                  <span className="font-semibold text-sm">{count}</span>
                  <span className="text-center leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <button onClick={start} disabled={eligibleLots.length === 0}
            className="w-full py-3 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
            ✨ Run AI on {eligibleLots.length} lots
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
          onCancel={() => { cancelRef.current = true }}
        />
      )}

      {/* ── Running AI ── */}
      {phase === "running" && (
        <ProgressCard
          title="Running AI…"
          subtitle={`${runProgress.done} / ${runProgress.total} lots processed`}
          pct={runProgress.total > 0 ? (runProgress.done / runProgress.total) * 100 : 0}
          log={log} logRef={logRef}
          onCancel={() => { cancelRef.current = true }}
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
  title, subtitle, pct, log, logRef, onCancel, liveResults,
}: {
  title: string; subtitle: string; pct: number
  log: string[]; logRef: React.RefObject<HTMLDivElement>
  onCancel: () => void
  liveResults?: { status: string; lotNumber: string }[]
}) {
  return (
    <div className="space-y-4">
      <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-6 py-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-300 font-medium">{title}</p>
          <button onClick={onCancel} className="text-xs text-gray-600 hover:text-red-400 transition-colors">Cancel</button>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2.5">
          <div className="bg-purple-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
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
