"use client"

import { useState, useRef, useEffect } from "react"
import type { LotGroup, LottingUpResult } from "@/app/api/lotting-up/route"
import { showError } from "@/lib/error-modal"

// ── Photo with CSS overlay ────────────────────────────────────────────────────

function PhotoOverlay({ imageUrl, groups, highlightId }: {
  imageUrl:    string
  groups:      LotGroup[]
  highlightId: number | null
}) {
  const g = highlightId !== null ? groups.find(x => x.id === highlightId) ?? null : null

  return (
    <div className="relative">
      <img src={imageUrl} alt="Upload" className="w-full h-auto block rounded-xl" />

      {g && (
        <>
          {/* Dark strip above the highlighted band */}
          <div className="absolute inset-x-0 top-0 bg-black/55 pointer-events-none rounded-t-xl"
            style={{ height: `${g.bounds.y}%` }} />
          {/* Dark strip below the highlighted band */}
          <div className="absolute inset-x-0 bottom-0 bg-black/55 pointer-events-none rounded-b-xl"
            style={{ height: `${100 - g.bounds.y - g.bounds.h}%` }} />

          {/* Coloured border on the highlighted band */}
          <div
            className="absolute inset-x-0 pointer-events-none"
            style={{
              top:             `${g.bounds.y}%`,
              height:          `${g.bounds.h}%`,
              border:          `3px solid ${g.colour}`,
              backgroundColor: `${g.colour}18`,
            }}
          />

          {/* Number badge */}
          <div
            className="absolute text-white text-xs font-bold px-2 py-0.5 rounded pointer-events-none"
            style={{
              left:            `6px`,
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

const DEFAULT_MODEL   = "gemini-2.5-flash-preview-04-17"
const MODEL_STORAGE_KEY = "lotting-up-model"

export default function LottingUpPage() {
  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [imageFile,   setImageFile]   = useState<File | null>(null)
  const [result,      setResult]      = useState<LottingUpResult | null>(null)
  const [analysing,   setAnalysing]   = useState(false)
  const [hoverId,     setHoverId]     = useState<number | null>(null)
  const [selectedId,  setSelectedId]  = useState<number | null>(null)
  const highlightId = selectedId ?? hoverId
  const [model,       setModel]       = useState(() =>
    (typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null) ?? DEFAULT_MODEL
  )
  const [modelList,   setModelList]   = useState<string[]>([DEFAULT_MODEL])
  const [savedDefault, setSavedDefault] = useState(() =>
    (typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null) ?? DEFAULT_MODEL
  )
  const [defaultSaved, setDefaultSaved] = useState(false)
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
    setHoverId(null)
    setSelectedId(null)
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
            {modelList.map(m => (
              <option key={m} value={m}>{m}{m === savedDefault ? " ★" : ""}</option>
            ))}
          </select>
          {defaultSaved ? (
            <span className="text-xs text-[#2AB4A6]">✓ Saved</span>
          ) : (
            <button
              onClick={() => {
                localStorage.setItem(MODEL_STORAGE_KEY, model)
                setSavedDefault(model)
                setDefaultSaved(true)
                setTimeout(() => setDefaultSaved(false), 2000)
              }}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                model === savedDefault
                  ? "border-gray-700 text-gray-600 cursor-default"
                  : "border-[#2AB4A6]/50 text-[#2AB4A6] hover:bg-[#2AB4A6]/10"
              }`}
              disabled={model === savedDefault}
            >
              {model === savedDefault ? "★ Default" : "Set as default"}
            </button>
          )}
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

          {/* Left — photo with overlays (sticky so it follows scroll) */}
          <div className="space-y-3 sticky top-6">
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

            <div className="rounded-xl bg-[#1C1C1E] border border-gray-800">
              {result ? (
                <PhotoOverlay imageUrl={imageUrl} groups={result.groups} highlightId={highlightId} />
              ) : (
                <img src={imageUrl} alt="Upload" className="w-full h-auto block rounded-xl" />
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
                {selectedId !== null && (
                  <p className="text-xs text-gray-500 text-center">
                    Lot {selectedId} pinned —{" "}
                    <button onClick={() => setSelectedId(null)} className="text-[#2AB4A6] hover:underline">
                      clear
                    </button>
                  </p>
                )}
                <div className="space-y-2">
                  {result.groups.map(g => {
                    const isSelected = selectedId === g.id
                    const isHighlighted = highlightId === g.id
                    return (
                    <div
                      key={g.id}
                      onMouseEnter={() => setHoverId(g.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => setSelectedId(isSelected ? null : g.id)}
                      className={`rounded-xl border transition-all cursor-pointer ${
                        isHighlighted
                          ? "bg-[#2C2C2E]"
                          : "border-gray-800 bg-[#1C1C1E] hover:bg-[#232323]"
                      }`}
                      style={{ borderColor: isHighlighted ? g.colour : undefined }}
                    >
                      {/* Card header */}
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ backgroundColor: g.colour }}>
                          {g.id}
                        </div>
                        <p className="text-sm font-medium text-white flex-1">{g.title}</p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isSelected && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium text-white"
                              style={{ backgroundColor: g.colour }}>
                              pinned
                            </span>
                          )}
                          <p className="text-sm font-semibold text-[#2AB4A6]">
                            £{g.estimateLow}–{g.estimateHigh}
                          </p>
                        </div>
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
                  )})}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
