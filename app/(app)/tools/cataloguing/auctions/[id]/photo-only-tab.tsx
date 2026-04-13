"use client"

import { useState, useRef, useTransition } from "react"
import { createPhotoSession } from "@/lib/actions/catalogue"

type Step = "barcodes" | "photos" | "review"

interface Session {
  id: string
  lotBarcode: string | null
  customerRef: string | null
  itemPhotoKeys: string[]
  status: string
  createdByName: string | null
  createdAt: string
}

interface Props {
  auctionId: string
  initialSessions: Session[]
}

const inputCls = "w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"

export default function PhotoOnlyTab({ auctionId, initialSessions }: Props) {
  const [step, setStep]             = useState<Step>("barcodes")
  const [twoMode, setTwoMode]       = useState(false)
  const [lotBarcode, setLotBarcode] = useState("")
  const [customerRef, setCustomerRef] = useState("")
  const [barcodeFile, setBarcodeFile]   = useState<File | null>(null)
  const [barcodePreview, setBarcodePreview] = useState<string | null>(null)
  const [itemPhotos, setItemPhotos] = useState<{ file: File; preview: string }[]>([])
  const [notes, setNotes]           = useState("")
  const [sessions, setSessions]     = useState<Session[]>(initialSessions)
  const [pending, start]            = useTransition()
  const [error, setError]           = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)

  const barcodeRef = useRef<HTMLInputElement>(null)
  const photoRef   = useRef<HTMLInputElement>(null)

  function handleBarcodePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (barcodePreview) URL.revokeObjectURL(barcodePreview)
    setBarcodeFile(f)
    setBarcodePreview(URL.createObjectURL(f))
  }

  function handleItemPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setItemPhotos(prev => [...prev, ...files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))])
    e.target.value = ""
  }

  function removeItem(i: number) {
    setItemPhotos(prev => { URL.revokeObjectURL(prev[i].preview); return prev.filter((_, j) => j !== i) })
  }

  function toPhotos() {
    if (!lotBarcode.trim()) { setError("Please enter the lot barcode."); return }
    setError(null); setStep("photos")
  }

  function toReview() {
    if (itemPhotos.length === 0) { setError("Please take at least one item photo."); return }
    setError(null); setStep("review")
  }

  function reset() {
    if (barcodePreview) URL.revokeObjectURL(barcodePreview)
    itemPhotos.forEach(p => URL.revokeObjectURL(p.preview))
    setStep("barcodes"); setTwoMode(false); setLotBarcode(""); setCustomerRef("")
    setBarcodeFile(null); setBarcodePreview(null); setItemPhotos([]); setNotes("")
    setError(null); setSaved(false)
  }

  function handleSave() {
    setError(null)
    const fd = new FormData()
    fd.set("auctionId", auctionId)
    fd.set("lotBarcode", lotBarcode.trim())
    if (twoMode && customerRef.trim()) fd.set("customerRef", customerRef.trim())
    if (barcodeFile) fd.set("barcodePhoto", barcodeFile)
    itemPhotos.forEach(p => fd.append("itemPhoto", p.file))
    if (notes.trim()) fd.set("notes", notes.trim())

    start(async () => {
      try {
        const record = await createPhotoSession(fd)
        setSessions(prev => [record, ...prev])
        setSaved(true)
        setTimeout(reset, 1800)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save")
      }
    })
  }

  const steps: { id: Step; label: string }[] = [
    { id: "barcodes", label: "Barcodes" },
    { id: "photos",   label: "Photos" },
    { id: "review",   label: "Review" },
  ]

  return (
    <div className="p-4 md:p-6 max-w-lg">

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-6">
        {steps.map((s, i) => {
          const done    = steps.findIndex(x => x.id === step) > i
          const current = step === s.id
          return (
            <div key={s.id} className="flex items-center">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                current ? "bg-[#2AB4A6] text-black" :
                done    ? "bg-[#2AB4A6]/40 text-[#2AB4A6]" :
                          "bg-gray-800 text-gray-500"
              }`}>{i + 1}</div>
              <span className={`ml-1.5 text-xs font-medium ${current ? "text-[#2AB4A6]" : done ? "text-[#2AB4A6]/60" : "text-gray-600"}`}>
                {s.label}
              </span>
              {i < steps.length - 1 && <div className="w-6 h-px bg-gray-700 mx-2" />}
            </div>
          )
        })}
      </div>

      {/* ── Step 1: Barcodes ── */}
      {step === "barcodes" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">Barcode details</h2>

          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
            <button
              onClick={() => setTwoMode(false)}
              className={`flex-1 py-2 font-medium transition-colors ${!twoMode ? "bg-[#2AB4A6] text-black" : "bg-[#2C2C2E] text-gray-400 hover:text-gray-200"}`}
            >
              Single barcode
            </button>
            <button
              onClick={() => setTwoMode(true)}
              className={`flex-1 py-2 font-medium transition-colors ${twoMode ? "bg-[#2AB4A6] text-black" : "bg-[#2C2C2E] text-gray-400 hover:text-gray-200"}`}
            >
              Two barcodes
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Lot barcode *</label>
            <input
              value={lotBarcode}
              onChange={e => setLotBarcode(e.target.value)}
              placeholder="e.g. BC-12345"
              className={inputCls}
            />
          </div>

          {twoMode && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Customer ID / Receipt number</label>
              <input
                value={customerRef}
                onChange={e => setCustomerRef(e.target.value)}
                placeholder="e.g. C000123"
                className={inputCls}
              />
            </div>
          )}

          {/* Optional barcode photo */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Barcode photo (optional)</label>
            <input
              ref={barcodeRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleBarcodePhoto}
            />
            {barcodePreview ? (
              <div className="relative w-32 h-24">
                <img src={barcodePreview} alt="Barcode" className="w-full h-full object-cover rounded-lg border border-gray-700" />
                <button
                  onClick={() => { URL.revokeObjectURL(barcodePreview!); setBarcodeFile(null); setBarcodePreview(null) }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center"
                >✕</button>
              </div>
            ) : (
              <button
                onClick={() => barcodeRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-gray-600 text-gray-400 hover:border-[#2AB4A6] hover:text-[#2AB4A6] text-sm transition-colors"
              >
                📷 Take barcode photo
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <button
            onClick={toPhotos}
            className="w-full py-3 bg-[#2AB4A6] hover:bg-[#24a090] text-black font-semibold rounded-lg text-sm transition-colors"
          >
            Next → Item Photos
          </button>
        </div>
      )}

      {/* ── Step 2: Item Photos ── */}
      {step === "photos" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">Item photos</h2>

          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleItemPhoto}
          />

          <button
            onClick={() => photoRef.current?.click()}
            className="w-full py-4 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-400 hover:text-[#2AB4A6] transition-colors flex flex-col items-center gap-1"
          >
            <span className="text-2xl">📷</span>
            <span className="text-sm font-medium">Take item photo</span>
            <span className="text-xs text-gray-600">Tap to open camera</span>
          </button>

          {itemPhotos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {itemPhotos.map((p, i) => (
                <div key={i} className="relative aspect-square">
                  <img src={p.preview} alt={`Item ${i + 1}`} className="w-full h-full object-cover rounded-lg border border-gray-700" />
                  <button
                    onClick={() => removeItem(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-600">{itemPhotos.length} photo{itemPhotos.length !== 1 ? "s" : ""} captured</p>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <button onClick={() => { setError(null); setStep("barcodes") }}
              className="flex-1 py-3 rounded-lg border border-gray-700 text-gray-400 text-sm font-medium hover:border-gray-500 transition-colors">
              ← Back
            </button>
            <button onClick={toReview}
              className="flex-1 py-3 bg-[#2AB4A6] hover:bg-[#24a090] text-black font-semibold rounded-lg text-sm transition-colors">
              Next → Review
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ── */}
      {step === "review" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">Review & save</h2>

          <div className="bg-[#1C1C1E] rounded-xl border border-gray-700 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Lot barcode</span>
              <span className="text-gray-200 font-mono">{lotBarcode}</span>
            </div>
            {twoMode && customerRef && (
              <div className="flex justify-between">
                <span className="text-gray-500">Customer / Receipt</span>
                <span className="text-gray-200 font-mono">{customerRef}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Barcode photo</span>
              <span className="text-gray-400">{barcodeFile ? "✓ Captured" : "None"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Item photos</span>
              <span className="text-gray-200">{itemPhotos.length} photo{itemPhotos.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Any extra notes..."
              className={`${inputCls} resize-none`}
            />
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
          {saved && <p className="text-xs text-[#2AB4A6] bg-[#2AB4A6]/10 rounded-lg px-3 py-2">✓ Session saved!</p>}

          <div className="flex gap-3">
            <button onClick={() => { setError(null); setStep("photos") }}
              className="flex-1 py-3 rounded-lg border border-gray-700 text-gray-400 text-sm font-medium hover:border-gray-500 transition-colors">
              ← Back
            </button>
            <button onClick={handleSave} disabled={pending || saved}
              className="flex-1 py-3 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              {pending ? "Saving…" : "Save Session"}
            </button>
          </div>
        </div>
      )}

      {/* ── Sessions list ── */}
      {sessions.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Saved sessions ({sessions.length})</h3>
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="bg-[#1C1C1E] rounded-lg border border-gray-800 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono text-gray-200 truncate">{s.lotBarcode ?? "—"}</p>
                  {s.customerRef && <p className="text-xs text-gray-500 truncate">{s.customerRef}</p>}
                  <p className="text-xs text-gray-600 mt-0.5">
                    {s.itemPhotoKeys.length} photo{s.itemPhotoKeys.length !== 1 ? "s" : ""}
                    {s.createdByName && ` · ${s.createdByName}`}
                    {" · "}{new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                  s.status === "MATCHED" ? "bg-green-900/50 text-green-300" : "bg-gray-700 text-gray-400"
                }`}>
                  {s.status === "MATCHED" ? "Matched" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
