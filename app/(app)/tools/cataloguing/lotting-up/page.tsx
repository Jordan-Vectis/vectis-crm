"use client"

import { useState, useRef, useEffect } from "react"
import type { LotGroup, LottingUpResult } from "@/app/api/lotting-up/route"
import { showError } from "@/lib/error-modal"

// ── Photo with CSS overlay ────────────────────────────────────────────────────
// Uses percentage-based absolute positioning so coordinates always match the
// displayed image regardless of screen size — no canvas scaling issues.

function PhotoOverlay({ imageUrl, groups, highlightId }: {
  imageUrl:    string
  groups:      LotGroup[]
  highlightId: number | null
}) {
  const g = highlightId !== null ? groups.find(x => x.id === highlightId) ?? null : null

  return (
    <div className="relative rounded-xl overflow-hidden">
      <img src={imageUrl} alt="Upload" className="w-full h-auto block" />

      {g && (
        <>
          {/* Dark vignette outside the box using box-shadow trick */}
          <div
            className="absolute rounded pointer-events-none"
            style={{
              left:      `${g.bounds.x}%`,
              top:       `${g.bounds.y}%`,
              width:     `${g.bounds.w}%`,
              height:    `${g.bounds.h}%`,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.5)`,
              border:    `3px solid ${g.colour}`,
              backgroundColor: `${g.colour}22`,
            }}
          />
          {/* Number badge */}
          <div
            className="absolute text-white text-xs font-bold px-2 py-0.5 rounded pointer-events-none"
            style={{
              left:            `calc(${g.bounds.x}% + 6px)`,
              top:             `calc(${g.bounds.y}% + 6px)`,
              backgroundColor: g.colour,
            }}
          >
            {g.id}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-2.5-flash-preview-04-17"

export default function LottingUpPage() {
  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [imageFile,   setImageFile]   = useState<File | null>(null)
  const [result,      setResult]      = useState<LottingUpResult | null>(null)
  const [analysing,   setAnalysing]   = useState(false)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const [model,       setModel]       = useState(DEFAULT_MODEL)
  const [modelList,   setModelList]   = useState<string[]>([DEFAULT_MODEL])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
  }, [])

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return
    setImageFile(file)
    setResult(null)
    setHighlightId(null)
    const reader = new FileReader()
    reader.onload = e => setImageUrl(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  async function analyse() {
    if (!imageFile || analysing) return
    setAnalysing(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append("photo", imageFile)
      fd.append("model", model)
      const res = await fetch("/api/lotting-up", { method: "POST", body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const data: LottingUpResult = await res.json()
      setResult(data)
    } catch (e: any) {
      showError("Analysis failed", e.message)
    } finally {
      setAnalysing(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Lotting Up</h1>
          <p className="text-sm text-gray-400 mt-1">
            Upload a photo of items and AI will suggest how to group them into auction lots with estimated values.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <label className="text-xs text-gray-500">Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-[#2AB4A6]">
            {modelList.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Upload area */}
      {!imageUrl && (
        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-700 hover:border-[#2AB4A6] rounded-2xl p-16 text-center cursor-pointer transition-colors group"
        >
          <div className="text-5xl mb-4">📷</div>
          <p className="text-white font-medium text-lg group-hover:text-[#2AB4A6] transition-colors">
            Drop a photo here or click to upload
          </p>
          <p className="text-gray-500 text-sm mt-1">JPG, PNG, WEBP supported</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onInputChange} />
        </div>
      )}

      {/* Photo + results */}
      {imageUrl && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* Left — photo with overlays */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-300">Photo</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setImageUrl(null); setImageFile(null); setResult(null); fileRef.current?.click() }}
                  className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1 rounded-lg transition-colors">
                  Change photo
                </button>
                <button
                  onClick={analyse}
                  disabled={analysing}
                  className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-1 rounded-lg transition-colors">
                  {analysing ? "Analysing…" : result ? "Re-analyse" : "✦ Analyse"}
                </button>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden bg-[#1C1C1E] border border-gray-800">
              {result ? (
                <PhotoOverlay imageUrl={imageUrl} groups={result.groups} highlightId={highlightId} />
              ) : (
                <img src={imageUrl} alt="Upload" className="w-full h-auto block" />
              )}
            </div>

            {analysing && (
              <div className="flex items-center gap-3 text-sm text-gray-400 bg-[#1C1C1E] border border-gray-800 rounded-xl px-4 py-3">
                <span className="animate-spin text-[#2AB4A6]">⟳</span>
                Analysing photo — this may take 10–20 seconds…
              </div>
            )}
          </div>

          {/* Right — results */}
          <div className="space-y-4">
            {!result && !analysing && (
              <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-8 text-center text-gray-600">
                <p className="text-3xl mb-3">✦</p>
                <p className="text-sm">Click <span className="text-[#2AB4A6]">Analyse</span> to get lot suggestions</p>
              </div>
            )}

            {result && (
              <>
                {/* Total estimate */}
                <div className="bg-[#1C1C1E] border border-[#2AB4A6]/30 rounded-xl px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Total estimate</p>
                    <p className="text-2xl font-bold text-white">
                      £{result.totalEstimateLow.toLocaleString()} – £{result.totalEstimateHigh.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Suggested lots</p>
                    <p className="text-2xl font-bold text-[#2AB4A6]">{result.groups.length}</p>
                  </div>
                </div>

                {/* Lot cards */}
                <div className="space-y-2">
                  {result.groups.map(g => (
                    <div
                      key={g.id}
                      onMouseEnter={() => setHighlightId(g.id)}
                      onMouseLeave={() => setHighlightId(null)}
                      className={`rounded-xl border transition-all cursor-default ${
                        highlightId === g.id
                          ? "border-opacity-60 bg-[#2C2C2E]"
                          : "border-gray-800 bg-[#1C1C1E] hover:bg-[#232323]"
                      }`}
                      style={{ borderColor: highlightId === g.id ? g.colour : undefined }}
                    >
                      {/* Card header */}
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ backgroundColor: g.colour }}>
                          {g.id}
                        </div>
                        <p className="text-sm font-medium text-white flex-1">{g.title}</p>
                        <p className="text-sm font-semibold text-[#2AB4A6] flex-shrink-0">
                          £{g.estimateLow}–{g.estimateHigh}
                        </p>
                      </div>

                      {/* Items + notes */}
                      <div className="px-4 py-3 space-y-2">
                        <ul className="space-y-0.5">
                          {g.items.map((item, i) => (
                            <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                              <span className="text-gray-600 mt-0.5 flex-shrink-0">·</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                        {g.notes && (
                          <p className="text-xs text-gray-500 italic border-t border-gray-800 pt-2">{g.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
