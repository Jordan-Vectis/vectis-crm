"use client"

import { useRef, useState } from "react"
import { uploadLotPhoto } from "@/lib/actions/catalogue"

interface Props {
  auctionId: string
  lots: { id: string; lotNumber: string }[]
  onUploaded: () => void
}

interface LotGroup {
  lotId:     string | null
  lotNumber: string
  photos:    File[]
}

type Phase = "idle" | "preview" | "uploading" | "done"

export default function PhotoUploadTab({ auctionId, lots, onUploaded }: Props) {
  const inputRef               = useRef<HTMLInputElement>(null)
  const [phase, setPhase]      = useState<Phase>("idle")
  const [groups, setGroups]    = useState<LotGroup[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError]      = useState<string | null>(null)
  const [skipped, setSkipped]  = useState<string[]>([])

  // Build a quick lookup: normalised lot number → lot id
  const lotMap = new Map(lots.map(l => [l.lotNumber.toLowerCase().trim(), l.id]))

  function isLotLabel(filename: string): string | null {
    const base = filename.replace(/\.[^.]+$/, "").trim()  // strip extension
    const key  = base.toLowerCase()
    if (lotMap.has(key)) return base
    return null
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    // Sort by filename so order matches capture sequence
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const result: LotGroup[] = []
    let current: LotGroup | null = null

    for (const file of files) {
      const lotNumber = isLotLabel(file.name)
      if (lotNumber) {
        // Start a new lot group
        current = { lotId: lotMap.get(lotNumber.toLowerCase()) ?? null, lotNumber, photos: [] }
        result.push(current)
      } else if (current) {
        // Add to current lot's photos (skip non-image files)
        if (file.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name)) {
          current.photos.push(file)
        }
      }
      // Files before the first lot label are ignored
    }

    if (result.length === 0) {
      setError("No lot label files found. Make sure the folder contains files named with lot numbers (e.g. F051292.JPG).")
      return
    }

    setGroups(result)
    setPhase("preview")
    e.target.value = ""
  }

  async function handleUpload() {
    const uploadable = groups.filter(g => g.lotId && g.photos.length > 0)
    if (uploadable.length === 0) { setError("No matched lots with photos to upload."); return }

    const total = uploadable.reduce((sum, g) => sum + g.photos.length, 0)
    setProgress({ done: 0, total })
    setPhase("uploading")
    setError(null)

    const skippedLots: string[] = []
    let done = 0

    for (const group of uploadable) {
      for (const photo of group.photos) {
        try {
          const fd = new FormData()
          fd.set("photo", photo)
          await uploadLotPhoto(group.lotId!, auctionId, fd)
        } catch {
          skippedLots.push(`${group.lotNumber}/${photo.name}`)
        }
        done++
        setProgress({ done, total })
      }
    }

    setSkipped(skippedLots)
    setPhase("done")
    onUploaded()
  }

  const matchedGroups   = groups.filter(g => g.lotId && g.photos.length > 0)
  const unmatchedGroups = groups.filter(g => !g.lotId)
  const emptyGroups     = groups.filter(g => g.lotId && g.photos.length === 0)
  const totalPhotos     = matchedGroups.reduce((sum, g) => sum + g.photos.length, 0)

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-gray-200">Smart Photo Uploader</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Select the folder containing your photos — lot label files (e.g. F051292.JPG) group the item photos that follow them.
        </p>
      </div>

      {/* ── Idle ── */}
      {phase === "idle" && (
        <>
          <input ref={inputRef} type="file" multiple
            // @ts-ignore — webkitdirectory is not in TS types
            webkitdirectory=""
            className="hidden" onChange={handleFiles} />
          <button onClick={() => inputRef.current?.click()}
            className="w-full py-10 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-400 hover:text-[#2AB4A6] transition-colors flex flex-col items-center gap-2">
            <span className="text-4xl">📁</span>
            <span className="text-sm font-medium">Select photo folder</span>
            <span className="text-xs text-gray-600">Choose the folder containing lot label + item photos</span>
          </button>
          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mt-3">{error}</p>}
        </>
      )}

      {/* ── Preview ── */}
      {phase === "preview" && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-[#2AB4A6]">{matchedGroups.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Lots matched</p>
            </div>
            <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-gray-200">{totalPhotos}</p>
              <p className="text-xs text-gray-500 mt-0.5">Photos to upload</p>
            </div>
            <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-4 py-3 text-center">
              <p className={`text-2xl font-bold ${unmatchedGroups.length > 0 ? "text-yellow-400" : "text-gray-600"}`}>
                {unmatchedGroups.length}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Unmatched labels</p>
            </div>
          </div>

          {/* Warnings */}
          {unmatchedGroups.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-400 font-medium mb-1">Labels not found in this auction:</p>
              <p className="text-xs text-yellow-600">{unmatchedGroups.map(g => g.lotNumber).join(", ")}</p>
            </div>
          )}
          {emptyGroups.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500">Lots with no photos following their label: {emptyGroups.map(g => g.lotNumber).join(", ")}</p>
            </div>
          )}

          {/* Lot list */}
          <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#141416] border-b border-gray-700">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Lot</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Photos</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Files</th>
                </tr>
              </thead>
              <tbody>
                {matchedGroups.map(g => (
                  <tr key={g.lotNumber} className="border-b border-gray-800 last:border-0">
                    <td className="px-4 py-2 font-mono text-[#2AB4A6]">{g.lotNumber}</td>
                    <td className="px-4 py-2 text-gray-300">{g.photos.length}</td>
                    <td className="px-4 py-2 text-gray-600 truncate max-w-[200px]">{g.photos.map(p => p.name).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <button onClick={() => { setGroups([]); setPhase("idle") }}
              className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">
              ← Back
            </button>
            <button onClick={handleUpload} disabled={matchedGroups.length === 0}
              className="flex-1 py-2.5 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              Upload {totalPhotos} photos to {matchedGroups.length} lots
            </button>
          </div>
        </div>
      )}

      {/* ── Uploading ── */}
      {phase === "uploading" && (
        <div className="space-y-4">
          <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-6 py-8 flex flex-col items-center gap-4">
            <p className="text-sm text-gray-300 font-medium">Uploading photos…</p>
            <div className="w-full bg-gray-800 rounded-full h-3">
              <div className="bg-[#2AB4A6] h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-gray-500">{progress.done} / {progress.total} photos</p>
          </div>
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
            <span className="text-4xl">✓</span>
            <p className="text-sm font-semibold text-[#2AB4A6]">Upload complete</p>
            <p className="text-xs text-gray-400">{progress.done} photos uploaded to {matchedGroups.length} lots</p>
          </div>
          {skipped.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-400">{skipped.length} photos failed to upload: {skipped.join(", ")}</p>
            </div>
          )}
          <button onClick={() => { setGroups([]); setSkipped([]); setPhase("idle") }}
            className="w-full py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">
            Upload another folder
          </button>
        </div>
      )}
    </div>
  )
}
