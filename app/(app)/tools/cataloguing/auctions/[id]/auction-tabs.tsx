"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { updateAuction, updateLot, deleteLot, deleteAuction, uploadLotPhoto, deleteLotPhoto } from "@/lib/actions/catalogue"
import LotWizardTab from "./lot-wizard-tab"
import PhotoOnlyTab from "./photo-only-tab"
import * as XLSX from "xlsx"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "settings" | "add-lot" | "manage-lots" | "photo-only"

interface Auction {
  id: string; code: string; name: string; auctionDate: Date | null
  auctionType: string; eventName: string | null; notes: string | null
  locked: boolean; finished: boolean; complete: boolean
}

interface Lot {
  id: string; lotNumber: string; title: string; description: string
  estimateLow: number | null; estimateHigh: number | null; reserve: number | null
  hammerPrice: number | null; condition: string | null; vendor: string | null
  tote: string | null; receipt: string | null; category: string | null
  subCategory: string | null; brand: string | null; notes: string | null
  status: string; createdByName: string | null; imageUrls: string[]
}


// ─── Constants ────────────────────────────────────────────────────────────────

const AUCTION_TYPES = [
  "GENERAL","DIECAST","TRAINS","VINYL","TV_FILM","MATCHBOX","COMICS","BEARS","DOLLS",
]

const CONDITIONS = ["Mint","Near Mint","Excellent","Good","Fair","Poor"]
const STATUSES   = ["ENTERED","REVIEWED","PUBLISHED","SOLD","UNSOLD","WITHDRAWN"]

const STATUS_STYLES: Record<string, string> = {
  ENTERED:   "bg-gray-700 text-gray-300",
  REVIEWED:  "bg-blue-900/50 text-blue-300",
  PUBLISHED: "bg-green-900/50 text-green-300",
  SOLD:      "bg-emerald-900/50 text-emerald-300",
  UNSOLD:    "bg-red-900/50 text-red-300",
  WITHDRAWN: "bg-orange-900/50 text-orange-300",
}

const input = "w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
const lbl   = "block text-xs font-medium text-gray-400 mb-1"

// ─── Main tabbed component ────────────────────────────────────────────────────

export default function AuctionTabs({ auction, lots }: { auction: Auction; lots: Lot[] }) {
  const router = useRouter()
  const [tab, setTab]              = useState<Tab>("manage-lots")
  const [editingLotId, setEditing] = useState<string | null>(null)

  const editingLot = lots.find(l => l.id === editingLotId) ?? null

  const tabs: { id: Tab; label: string }[] = [
    { id: "manage-lots",  label: `Manage Lots (${lots.length})` },
    { id: "add-lot",      label: "Add Lot" },
    { id: "photo-only",   label: "Photo Only Cataloguing" },
    { id: "settings",     label: "Auction Settings" },
  ]

  function switchTab(t: Tab) { setTab(t); setEditing(null) }

  return (
    <div className="flex flex-col h-full p-6 gap-0">

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push("/tools/cataloguing/auctions")}
          className="text-sm text-[#2AB4A6] hover:text-[#24a090] transition-colors">
          ← Auctions
        </button>
        <span className="text-gray-700">/</span>
        <span className="font-mono font-bold text-[#2AB4A6]">{auction.code}</span>
        <span className="text-gray-300 font-medium">{auction.name}</span>
        {auction.locked   && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300">Locked</span>}
        {auction.finished && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/50 text-yellow-300">Finished</span>}
        {auction.complete && <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-300">Complete</span>}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-700 mb-6 overflow-x-auto scrollbar-none -mx-6 px-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => switchTab(t.id)}
            className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              tab === t.id
                ? "border-[#2AB4A6] text-[#2AB4A6]"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels — LotWizardTab stays mounted to preserve pins/state */}
      {tab === "settings" && <SettingsTab auction={auction} />}

      <div className={tab === "add-lot" ? "" : "hidden"}>
        <LotWizardTab auctionId={auction.id} auction={auction}
          onCreated={() => router.refresh()} />
      </div>

      {tab === "manage-lots" && (
        editingLotId
          ? <LotEditView lot={editingLot} auctionId={auction.id}
              onDone={() => { setEditing(null); router.refresh() }} />
          : <ManageLotsTab lots={lots} auctionId={auction.id} auction={auction}
              onEdit={setEditing}
              onDelete={() => router.refresh()} />
      )}

      {tab === "photo-only" && (
        <PhotoOnlyTab auctionId={auction.id} auctionCode={auction.code} onCreated={() => router.refresh()} />
      )}
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab({ auction }: { auction: Auction }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const defaultDate = auction.auctionDate
    ? new Date(auction.auctionDate).toISOString().split("T")[0]
    : ""

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      await updateAuction(auction.id, fd)
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    })
  }

  async function handleDelete() {
    start(async () => {
      await deleteAuction(auction.id)
      router.push("/tools/cataloguing/auctions")
    })
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Code *</label>
            <input name="code" required defaultValue={auction.code}
              className={`${input} uppercase`} />
          </div>
          <div>
            <label className={lbl}>Date</label>
            <input name="auctionDate" type="date" defaultValue={defaultDate} className={input} />
          </div>
        </div>

        <div>
          <label className={lbl}>Name *</label>
          <input name="name" required defaultValue={auction.name} className={input} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Type</label>
            <select name="auctionType" defaultValue={auction.auctionType} className={input}>
              {AUCTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Event Name</label>
            <input name="eventName" defaultValue={auction.eventName ?? ""} className={input} />
          </div>
        </div>

        <div>
          <label className={lbl}>Notes</label>
          <textarea name="notes" rows={3} defaultValue={auction.notes ?? ""}
            className={`${input} resize-none`} />
        </div>

        <div className="flex gap-6">
          {["locked","finished","complete"].map(f => (
            <label key={f} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name={f} value="true"
                defaultChecked={(auction as any)[f]}
                className="w-4 h-4 rounded border-gray-600 accent-[#2AB4A6]" />
              <span className="text-sm text-gray-400 capitalize">{f}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={pending}
            className="bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-white font-semibold text-sm px-6 py-2 rounded-lg transition-colors">
            {pending ? "Saving…" : "Save Changes"}
          </button>
          {saved && <span className="text-sm text-[#2AB4A6]">✓ Saved</span>}
        </div>
      </form>

      {/* Danger zone */}
      <div className="mt-10 border border-red-900/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-red-400 mb-1">Danger Zone</h3>
        <p className="text-xs text-gray-500 mb-3">Permanently delete this auction and all its lots.</p>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="text-sm px-4 py-2 border border-red-800 text-red-400 rounded-lg hover:bg-red-900/30 transition-colors">
            Delete Auction
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-red-300">Are you sure?</span>
            <button onClick={handleDelete} disabled={pending}
              className="text-sm px-4 py-2 bg-red-900/50 border border-red-700 text-red-300 rounded-lg hover:bg-red-900/70 transition-colors disabled:opacity-50">
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Manage lots tab ──────────────────────────────────────────────────────────

function ManageLotsTab({ lots, auctionId, auction, onEdit, onDelete }: {
  lots: Lot[]; auctionId: string
  auction: { code: string; name: string }
  onEdit: (id: string) => void
  onDelete: () => void
}) {
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function exportExcel() {
    const rows = lots.map(l => ({
      "Lot No.":      l.lotNumber,
      "Title":        l.title,
      "Description":  l.description,
      "Estimate Low": l.estimateLow ?? "",
      "Estimate High":l.estimateHigh ?? "",
      "Reserve":      l.reserve ?? "",
      "Hammer Price": l.hammerPrice ?? "",
      "Condition":    l.condition ?? "",
      "Status":       l.status,
      "Vendor":       l.vendor ?? "",
      "Tote":         l.tote ?? "",
      "Receipt":      l.receipt ?? "",
      "Category":     l.category ?? "",
      "Sub-Category": l.subCategory ?? "",
      "Brand":        l.brand ?? "",
      "Notes":        l.notes ?? "",
      "Added By":     l.createdByName ?? "",
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Lots")
    XLSX.writeFile(wb, `${auction.code}_${auction.name}_lots.xlsx`.replace(/\s+/g, "_"))
  }

  async function handleDelete(lot: Lot) {
    if (!confirm(`Delete lot "${lot.lotNumber} — ${lot.title}"?`)) return
    setDeleting(lot.id)
    start(async () => {
      await deleteLot(lot.id, auctionId)
      setDeleting(null)
      onDelete()
    })
  }

  if (lots.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600">
        No lots yet — use the <span className="text-gray-400">Add Lot</span> tab to get started.
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={exportExcel}
          className="px-4 py-1.5 text-sm font-medium rounded-lg border border-[#2AB4A6] text-[#2AB4A6] hover:bg-[#2AB4A6] hover:text-black transition-colors">
          ⬇ Export to Excel
        </button>
      </div>
    <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl overflow-x-auto">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="border-b border-gray-700 bg-[#141416]">
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Lot No.</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Title</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Vendor</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Receipt</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Photos</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {lots.map(lot => (
            <tr key={lot.id} className="border-b border-gray-800 last:border-0 hover:bg-[#2C2C2E] transition-colors cursor-pointer" onClick={() => onEdit(lot.id)}>
              <td className="px-4 py-3 font-mono font-semibold text-[#2AB4A6] whitespace-nowrap">{lot.lotNumber}</td>
              <td className="px-4 py-3 text-gray-200 max-w-[160px] truncate">{lot.title || <span className="text-gray-600 italic">Uncatalogued</span>}</td>
              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{lot.vendor ?? "—"}</td>
              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{lot.receipt ?? "—"}</td>
              <td className="px-4 py-3 text-gray-400 text-xs">
                {lot.category ? (
                  <span>{lot.category}{lot.subCategory && <span className="text-gray-600"> › {lot.subCategory}</span>}</span>
                ) : "—"}
              </td>
              <td className="px-4 py-3">
                {lot.imageUrls.length > 0 ? (
                  <span className="text-xs bg-[#2AB4A6]/20 text-[#2AB4A6] px-2 py-0.5 rounded-full font-medium">
                    {lot.imageUrls.length}
                  </span>
                ) : <span className="text-gray-700 text-xs">—</span>}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[lot.status] ?? "bg-gray-700 text-gray-300"}`}>
                  {lot.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                <button onClick={() => handleDelete(lot)} disabled={deleting === lot.id || pending}
                  className="text-xs text-red-500 hover:text-red-400 transition-colors disabled:opacity-40">
                  {deleting === lot.id ? "…" : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  )
}

// ─── Lot edit view (inside manage-lots tab) ───────────────────────────────────

function LotEditView({ lot, auctionId, onDone }: { lot: Lot | null; auctionId: string; onDone: () => void }) {
  const [pending, start]             = useTransition()
  const [imageKeys, setImageKeys]    = useState<string[]>(lot?.imageUrls ?? [])
  const [signedUrls, setSignedUrls]  = useState<Record<string, string>>({})
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!lot || imageKeys.length === 0) return
    const missing = imageKeys.filter(k => !signedUrls[k])
    if (missing.length === 0) return
    setLoadingPhotos(true)
    Promise.all(
      missing.map(async key => {
        const res = await fetch(`/api/catalogue/signed-url?key=${encodeURIComponent(key)}`)
        const { url } = await res.json()
        return [key, url] as [string, string]
      })
    ).then(results => {
      setSignedUrls(prev => ({ ...prev, ...Object.fromEntries(results) }))
      setLoadingPhotos(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKeys])

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !lot) return
    e.target.value = ""
    setUploadingPhoto(true)
    try {
      const fd = new FormData()
      fd.set("photo", file)
      const updated = await uploadLotPhoto(lot.id, auctionId, fd)
      setImageKeys(updated)
    } finally { setUploadingPhoto(false) }
  }

  async function handlePhotoDelete(key: string) {
    if (!lot || !confirm("Remove this photo?")) return
    const updated = await deleteLotPhoto(lot.id, auctionId, key)
    setImageKeys(updated)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!lot) return
    const fd = new FormData(e.currentTarget)
    start(async () => {
      await updateLot(lot.id, auctionId, fd)
      onDone()
    })
  }

  if (!lot) return null

  const defaultDate = ""  // lots don't have a date field, placeholder

  return (
    <div>
      <button onClick={onDone} className="text-sm text-[#2AB4A6] hover:text-[#24a090] transition-colors mb-5">
        ← Back to lots
      </button>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-6">
          {/* Left */}
          <div className="space-y-4">
            <div>
              <label className={lbl}>Lot Number *</label>
              <input name="lotNumber" required defaultValue={lot.lotNumber} className={input} />
            </div>
            <div>
              <label className={lbl}>Title *</label>
              <input name="title" required defaultValue={lot.title} className={input} />
            </div>
            <div>
              <label className={lbl}>Description</label>
              <textarea name="description" rows={4} defaultValue={lot.description}
                className={`${input} resize-none`} />
            </div>
            <div>
              <label className={lbl}>Condition</label>
              <select name="condition" defaultValue={lot.condition ?? ""} className={input}>
                <option value="">— Select —</option>
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Status</label>
              <select name="status" defaultValue={lot.status} className={input}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Notes</label>
              <textarea name="notes" rows={2} defaultValue={lot.notes ?? ""}
                className={`${input} resize-none`} />
            </div>
          </div>

          {/* Right */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Estimate Low (£)</label>
                <input name="estimateLow" type="number" min="0" defaultValue={lot.estimateLow ?? ""} className={input} />
              </div>
              <div>
                <label className={lbl}>Estimate High (£)</label>
                <input name="estimateHigh" type="number" min="0" defaultValue={lot.estimateHigh ?? ""} className={input} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Reserve (£)</label>
                <input name="reserve" type="number" min="0" defaultValue={lot.reserve ?? ""} className={input} />
              </div>
              <div>
                <label className={lbl}>Hammer Price (£)</label>
                <input name="hammerPrice" type="number" min="0" defaultValue={lot.hammerPrice ?? ""} className={input} />
              </div>
            </div>
            <div>
              <label className={lbl}>Vendor</label>
              <input name="vendor" defaultValue={lot.vendor ?? ""} className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Tote</label>
                <input name="tote" defaultValue={lot.tote ?? ""} className={input} />
              </div>
              <div>
                <label className={lbl}>Receipt</label>
                <input name="receipt" defaultValue={lot.receipt ?? ""} className={input} />
              </div>
            </div>
            <div>
              <label className={lbl}>Category</label>
              <input name="category" defaultValue={lot.category ?? ""} className={input} />
            </div>
            <div>
              <label className={lbl}>Sub-Category</label>
              <input name="subCategory" defaultValue={lot.subCategory ?? ""} className={input} />
            </div>
            <div>
              <label className={lbl}>Brand</label>
              <input name="brand" defaultValue={lot.brand ?? ""} className={input} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-gray-700">
          <button onClick={onDone} type="button"
            className="px-4 py-2 rounded-lg border border-gray-700 bg-[#2C2C2E] text-sm text-gray-400 hover:bg-[#3C3C3E] transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={pending}
            className="bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-white font-semibold text-sm px-6 py-2 rounded-lg transition-colors">
            {pending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      {/* ── Photo management ── */}
      <div className="mt-6 border-t border-gray-800 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">Photos ({imageKeys.length})</h3>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
          <button onClick={() => photoRef.current?.click()} disabled={uploadingPhoto}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-400 hover:text-[#2AB4A6] text-xs transition-colors disabled:opacity-50">
            {uploadingPhoto ? "Uploading…" : "📷 Add photo"}
          </button>
        </div>

        {loadingPhotos && <p className="text-xs text-gray-600">Loading photos…</p>}

        {!loadingPhotos && imageKeys.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {imageKeys.map(key => (
              <div key={key} className="relative aspect-square group">
                {signedUrls[key] ? (
                  <a href={signedUrls[key]} target="_blank" rel="noopener noreferrer">
                    <img src={signedUrls[key]} alt="Lot photo" className="w-full h-full object-cover rounded-lg border border-gray-700" />
                  </a>
                ) : (
                  <div className="w-full h-full rounded-lg bg-gray-800 animate-pulse" />
                )}
                <button onClick={() => handlePhotoDelete(key)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-700 rounded-full text-white text-xs items-center justify-center hidden group-hover:flex">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {!loadingPhotos && imageKeys.length === 0 && (
          <p className="text-xs text-gray-600">No photos yet.</p>
        )}
      </div>
    </div>
  )
}
