"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import type { LotGroup, LottingUpResult } from "@/app/api/lotting-up/route"
import { showError } from "@/lib/error-modal"

// ── Zone → canvas rectangle (% of image width/height) ────────────────────────

const ZONE_RECTS: Record<string, { x: number; y: number; w: number; h: number }> = {
  "top-left":      { x: 0,    y: 0,    w: 45, h: 45 },
  "top-center":    { x: 27.5, y: 0,    w: 45, h: 45 },
  "top-right":     { x: 55,   y: 0,    w: 45, h: 45 },
  "middle-left":   { x: 0,    y: 27.5, w: 45, h: 45 },
  "middle-center": { x: 27.5, y: 27.5, w: 45, h: 45 },
  "middle-right":  { x: 55,   y: 27.5, w: 45, h: 45 },
  "bottom-left":   { x: 0,    y: 55,   w: 45, h: 45 },
  "bottom-center": { x: 27.5, y: 55,   w: 45, h: 45 },
  "bottom-right":  { x: 55,   y: 55,   w: 45, h: 45 },
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

// ── Overlay canvas ─────────────────────────────────────────────────────────────

function OverlayCanvas({ imageUrl, groups, highlightId }: {
  imageUrl: string
  groups:   LotGroup[]
  highlightId: number | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)

      groups.forEach(g => {
        const zone = ZONE_RECTS[g.position] ?? ZONE_RECTS["middle-center"]
        const x = (zone.x / 100) * img.naturalWidth
        const y = (zone.y / 100) * img.naturalHeight
        const w = (zone.w / 100) * img.naturalWidth
        const h = (zone.h / 100) * img.naturalHeight

        const { r, g: gv, b } = hexToRgb(g.colour)
        const isHighlit = highlightId === g.id
        const alpha = isHighlit ? 0.35 : (highlightId !== null ? 0.08 : 0.18)

        // Filled rectangle
        ctx.fillStyle = `rgba(${r},${gv},${b},${alpha})`
        ctx.fillRect(x, y, w, h)

        // Border
        ctx.strokeStyle = `rgba(${r},${gv},${b},${isHighlit ? 0.95 : 0.55})`
        ctx.lineWidth   = isHighlit ? Math.max(3, img.naturalWidth * 0.004) : Math.max(2, img.naturalWidth * 0.002)
        ctx.strokeRect(x, y, w, h)

        // Label badge
        const fontSize  = Math.max(12, Math.min(22, img.naturalWidth * 0.022))
        const padding   = fontSize * 0.5
        const text      = `${g.id}`
        ctx.font        = `bold ${fontSize}px sans-serif`
        const textW     = ctx.measureText(text).width
        const badgeW    = textW + padding * 2
        const badgeH    = fontSize + padding
        const bx        = x + 6
        const by        = y + 6

        ctx.fillStyle = `rgba(${r},${gv},${b},${isHighlit ? 1 : 0.75})`
        ctx.beginPath()
        ctx.roundRect(bx, by, badgeW, badgeH, 4)
        ctx.fill()

        ctx.fillStyle = "white"
        ctx.fillText(text, bx + padding, by + fontSize * 0.85)
      })
    }
    img.src = imageUrl
  }, [imageUrl, groups, highlightId])

  useEffect(() => { draw() }, [draw])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-auto rounded-xl object-contain"
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LottingUpPage() {
  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [imageFile,   setImageFile]   = useState<File | null>(null)
  const [result,      setResult]      = useState<LottingUpResult | null>(null)
  const [analysing,   setAnalysing]   = useState(false)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
      <div>
        <h1 className="text-2xl font-semibold text-white">Lotting Up</h1>
        <p className="text-sm text-gray-400 mt-1">
          Upload a photo of items and AI will suggest how to group them into auction lots with estimated values.
        </p>
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
                <OverlayCanvas imageUrl={imageUrl} groups={result.groups} highlightId={highlightId} />
              ) : (
                <img src={imageUrl} alt="Upload" className="w-full h-auto" />
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
