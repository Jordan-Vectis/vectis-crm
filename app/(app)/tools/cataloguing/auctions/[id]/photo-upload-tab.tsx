"use client"

import { useRef, useState } from "react"
import { uploadLotPhoto } from "@/lib/actions/catalogue"

interface Props {
  auctionId: string
  lots: { id: string; lotNumber: string; barcode: string | null }[]
  onUploaded: () => void
}

interface LotGroup {
  lotId:     string | null
  lotNumber: string
  photos:    File[]
}

type Phase = "idle" | "scanning" | "preview" | "uploading" | "done"

export default function PhotoUploadTab({ auctionId, lots, onUploaded }: Props) {
  const inputRef                  = useRef<HTMLInputElement>(null)
  const [phase, setPhase]         = useState<Phase>("idle")
  const [groups, setGroups]       = useState<LotGroup[]>([])
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 })
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [error, setError]         = useState<string | null>(null)
  const [skipped, setSkipped]     = useState<string[]>([])

  // Lookup: barcode → lot id (falls back to lotNumber for older lots pre-migration)
  const lotMap = new Map([
    ...lots.map(l => [l.lotNumber.toLowerCase().trim(), l.id] as [string, string]),
    ...lots.filter(l => l.barcode).map(l => [l.barcode!.toLowerCase().trim(), l.id] as [string, string]),
  ])

  async function decodeBarcode(file: File): Promise<string | null> {
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser")
      const reader = new BrowserMultiFormatReader()
      const url    = URL.createObjectURL(file)
      try {
        const result = await reader.decodeFromImageUrl(url)
        return result.getText()
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      return null
    }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(e.target.files ?? []).filter(
      f => f.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.name)
    )
    if (files.length === 0) return

    // Sort by filename so order matches capture sequence
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    setPhase("scanning")
    setScanProgress({ done: 0, total: files.length })

    const result: LotGroup[] = []
    let current: LotGroup | null = null

    for (let i = 0; i < files.length; i++) {
      setScanProgress({ done: i + 1, total: files.length })
      const file    = files[i]
      const barcode = await decodeBarcode(file)

      if (barcode) {
        const key   = barcode.toLowerCase().trim()
        const lotId = lotMap.get(key) ?? null
        current = { lotId, lotNumber: barcode, photos: [] }
        result.push(current)
      } else if (current) {
        current.photos.push(file)
      }
      // Images before the first detected barcode are ignored
    }

    e.target.value = ""

    if (result.length === 0) {
      setError("No barcodes detected in any of the images. Make sure the lot label photos are included and in focus.")
      setPhase("idle")
      return
    }

    setGroups(result)
    setPhase("preview")
  }

  async function handleUpload() {
    const uploadable = groups.filter(g => g.lotId && g.photos.length > 0)
    if (uploadable.length === 0) { setError("No matched lots with photos to upload."); return }

    const total = uploadable.reduce((sum, g) => sum + g.photos.length, 0)
    setUploadProgress({ done: 0, total })
    setPhase("uploading")

    const failedList: string[] = []
    let done = 0

    for (const group of uploadable) {
      for (const photo of group.photos) {
        try {
          const fd = new FormData()
          fd.set("photo", photo)
          await uploadLotPhoto(group.lotId!, auctionId, fd)
        } catch {
          failedList.push(`${group.lotNumber}/${photo.name}`)
        }
        done++
        setUploadProgress({ done, total })
      }
    }

    setSkipped(failedList)
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
          Select the folder of photos — barcodes are read from each image to group item photos under the right lot.
        </p>
      </div>

      {/* ── Idle ── */}
      {phase === "idle" && (
        <>
          <input ref={inputRef} type="file" multiple
            // @ts-ignore
            webkitdirectory=""
            className="hidden" onChange={handleFiles} />
          <button onClick={() => inputRef.current?.click()}
            className="w-full py-10 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-400 hover:text-[#2AB4A6] transition-colors flex flex-col items-center gap-2">
            <span className="text-4xl">📁</span>
            <span className="text-sm font-medium">Select photo folder</span>
            <span className="text-xs text-gray-600">Barcodes will be automatically detected from the images</span>
          </button>
          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mt-3">{error}</p>}
        </>
      )}

      {/* ── Scanning ── */}
      {phase === "scanning" && (
        <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-6 py-10 flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#2AB4A6] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-300 font-medium">Scanning for barcodes…</p>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div className="bg-[#2AB4A6] h-2 rounded-full transition-all duration-200"
              style={{ width: `${scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-gray-500">{scanProgress.done} / {scanProgress.total} images scanned</p>
        </div>
      )}

      {/* ── Preview ── */}
      {phase === "preview" && (
        <div className="space-y-4">
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
              <p className="text-xs text-gray-500 mt-0.5">Unmatched barcodes</p>
            </div>
          </div>

          {unmatchedGroups.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-400 font-medium mb-1">Barcodes detected but not found in this auction:</p>
              <p className="text-xs text-yellow-600">{unmatchedGroups.map(g => g.lotNumber).join(", ")}</p>
            </div>
          )}
          {emptyGroups.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500">Lots with no photos after their barcode: {emptyGroups.map(g => g.lotNumber).join(", ")}</p>
            </div>
          )}

          <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#141416] border-b border-gray-700 sticky top-0">
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
        <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl px-6 py-10 flex flex-col items-center gap-4">
          <p className="text-sm text-gray-300 font-medium">Uploading photos…</p>
          <div className="w-full bg-gray-800 rounded-full h-3">
            <div className="bg-[#2AB4A6] h-3 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-gray-500">{uploadProgress.done} / {uploadProgress.total} photos</p>
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
            <span className="text-4xl">✓</span>
            <p className="text-sm font-semibold text-[#2AB4A6]">Upload complete</p>
            <p className="text-xs text-gray-400">{uploadProgress.done} photos uploaded to {matchedGroups.length} lots</p>
          </div>
          {skipped.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-400">{skipped.length} photos failed: {skipped.join(", ")}</p>
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
