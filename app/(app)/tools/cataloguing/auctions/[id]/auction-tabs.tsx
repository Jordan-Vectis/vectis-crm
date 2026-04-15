"use client"

import { useState, useTransition, useRef, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { updateAuction, updateLot, deleteLot, deleteAuction, uploadLotPhoto, deleteLotPhoto, fillLotsFromTotes, togglePublished, generateTitlesFromDescriptions, assignLotNumbers, setStartingBids } from "@/lib/actions/catalogue"
import LotWizardTab, { CATEGORY_MAP, BRANDS_LIST } from "./lot-wizard-tab"
import PhotoOnlyTab from "./photo-only-tab"
import ImportTab from "./import-tab"
import PhotoUploadTab from "./photo-upload-tab"
import AiUpgradeTab from "./ai-upgrade-tab"
import * as XLSX from "xlsx"
import JSZip from "jszip"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "settings" | "add-lot" | "manage-lots" | "photo-only" | "import" | "upload-photos" | "ai-upgrade"

interface Auction {
  id: string; code: string; name: string; auctionDate: Date | null
  auctionType: string; eventName: string | null; notes: string | null
  locked: boolean; finished: boolean; complete: boolean; published: boolean
}

interface Lot {
  id: string; lotNumber: string; title: string; description: string
  estimateLow: number | null; estimateHigh: number | null; startingBid: number | null; reserve: number | null
  hammerPrice: number | null; condition: string | null; vendor: string | null
  tote: string | null; receipt: string | null; category: string | null
  subCategory: string | null; brand: string | null; notes: string | null
  status: string; createdByName: string | null; imageUrls: string[]
}


// ─── Constants ────────────────────────────────────────────────────────────────

// Title character limit — matches the longest standard Vectis title format
const TITLE_LIMIT = 83

// Round a value UP to the nearest bidding increment
function roundUpToIncrement(value: number): number {
  if (value <= 0)     return 5
  if (value <= 50)    return Math.ceil(value / 5)   * 5
  if (value <= 200)   return Math.ceil(value / 10)  * 10
  if (value <= 700)   return Math.ceil(value / 20)  * 20
  if (value <= 1000)  return Math.ceil(value / 50)  * 50
  if (value <= 3000)  return Math.ceil(value / 100) * 100
  if (value <= 7000)  return Math.ceil(value / 200) * 200
  if (value <= 10000) return Math.ceil(value / 500) * 500
  return Math.ceil(value / 1000) * 1000
}

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
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab]             = useState<Tab>("manage-lots")
  const [published, setPublished] = useState(auction.published)
  const [pubPending, startPub]    = useTransition()

  const editingLotId = searchParams.get("lot")
  const editingLot   = lots.find(l => l.id === editingLotId) ?? null

  function openLot(id: string) {
    router.push(`/tools/cataloguing/auctions/${auction.id}?lot=${id}`)
  }

  function closeLot() {
    router.push(`/tools/cataloguing/auctions/${auction.id}`)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "manage-lots",  label: `Manage Lots (${lots.length})` },
    { id: "add-lot",      label: "Add Lot" },
    { id: "photo-only",   label: "Photo Only Cataloguing" },
    { id: "import",        label: "Import Lots" },
    { id: "upload-photos", label: "Upload Photos" },
    { id: "ai-upgrade",   label: "✨ AI Upgrade" },
    { id: "settings",     label: "Auction Settings" },
  ]

  function switchTab(t: Tab) { setTab(t) }

  function handleTogglePublish() {
    const next = !published
    startPub(async () => {
      await togglePublished(auction.id, next)
      setPublished(next)
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-0">

      {/* Header */}
      <div className="flex items-center gap-3 mb-5 flex-shrink-0">
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
        {published && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300">● Live on Site</span>}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => {
            const data = lots.filter(l => l.description).map(l => ({
              Folder:      l.lotNumber,
              Description: l.description,
              Estimate:    l.estimateLow && l.estimateHigh ? `Estimate: £${l.estimateLow}–£${l.estimateHigh}` : "",
            }))
            localStorage.setItem("copier_preload", JSON.stringify(data))
            window.open("/tools/auction-ai?tab=copier", "_blank")
          }}
            className="text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors bg-[#C8A96E]/10 border border-[#C8A96E]/40 text-[#C8A96E] hover:bg-[#C8A96E]/20">
            📋 Description Copier
          </button>
          <button onClick={() => switchTab("ai-upgrade")}
            className="text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors bg-purple-900/20 border border-purple-700/40 text-purple-300 hover:bg-purple-900/40">
            ✨ Upgrade descriptions with AI
          </button>
          <button
            onClick={handleTogglePublish}
            disabled={pubPending}
            className={`text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
              published
                ? "bg-red-900/30 border border-red-700 text-red-300 hover:bg-red-900/50"
                : "bg-emerald-900/30 border border-emerald-700 text-emerald-300 hover:bg-emerald-900/50"
            }`}
          >
            {pubPending ? "…" : published ? "Unpublish from Site" : "Publish to Site"}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-700 mb-6 overflow-x-auto scrollbar-none -mx-6 px-6">
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

      {/* Tab panels — scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "settings" && <SettingsTab auction={auction} />}

        <div className={tab === "add-lot" ? "" : "hidden"}>
          <LotWizardTab auctionId={auction.id} auction={auction}
            onCreated={() => router.refresh()} />
        </div>

        {tab === "manage-lots" && (
          editingLotId
            ? <LotEditView lot={editingLot} auctionId={auction.id}
                onDone={closeLot} />
            : <ManageLotsTab lots={lots} auctionId={auction.id} auction={auction}
                onEdit={openLot}
                onDelete={() => router.push(`/tools/cataloguing/auctions/${auction.id}`)} />
        )}

        {tab === "photo-only" && (
          <PhotoOnlyTab auctionId={auction.id} auctionCode={auction.code} onCreated={() => router.refresh()} />
        )}

        {tab === "import" && (
          <ImportTab auctionId={auction.id} auctionCode={auction.code} onImported={() => router.push(`/tools/cataloguing/auctions/${auction.id}`)} />
        )}

        {tab === "upload-photos" && (
          <PhotoUploadTab auctionId={auction.id} lots={lots} onUploaded={() => router.refresh()} />
        )}

        {tab === "ai-upgrade" && (
          <AiUpgradeTab
            auctionId={auction.id}
            lots={lots}
            onDone={() => router.push(`/tools/cataloguing/auctions/${auction.id}`)}
          />
        )}
      </div>
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

const COL_INPUT  = "w-full rounded border border-gray-700 bg-[#0d0d0f] px-2 py-1 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"
const COL_SELECT = "w-full rounded border border-gray-700 bg-[#0d0d0f] px-1 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"

function colMatch(value: string | null | undefined, filter: string) {
  if (!filter.trim()) return true
  return (value ?? "").toLowerCase().includes(filter.toLowerCase().trim())
}

function ManageLotsTab({ lots, auctionId, auction, onEdit, onDelete }: {
  lots: Lot[]; auctionId: string
  auction: { code: string; name: string }
  onEdit: (id: string) => void
  onDelete: () => void
}) {
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [pending, start]            = useTransition()
  const [fillPending, startFill]    = useTransition()
  const [fillMsg, setFillMsg]       = useState<string | null>(null)
  const [photoExporting, setPhotoExporting] = useState(false)
  const [photoMsg, setPhotoMsg]     = useState<string | null>(null)

  // Generate titles
  const [titlesMsg, setTitlesMsg]   = useState<string | null>(null)
  const [titlesPending, startTitles] = useTransition()

  // Autolotter panel
  const [showAutolotter, setShowAutolotter] = useState(false)
  const [sortMode, setSortMode] = useState<"subcat" | "vendor" | "subcat_vendor" | "vendor_subcat">("subcat")
  const [lotterMsg, setLotterMsg] = useState<string | null>(null)
  const [lotterPending, startLotter] = useTransition()

  // Starting bid panel
  const [showBids, setShowBids] = useState(false)
  const [bidPct, setBidPct]     = useState(60)
  const [bidsMsg, setBidsMsg]   = useState<string | null>(null)
  const [bidsPending, startBids] = useTransition()

  // ── Per-column filters ──────────────────────────────────────────────────
  const [fLotNo,    setFLotNo]    = useState("")
  const [fTitle,    setFTitle]    = useState("")
  const [fVendor,   setFVendor]   = useState("")
  const [fReceipt,  setFReceipt]  = useState("")
  const [fTote,     setFTote]     = useState("")
  const [fCategory, setFCategory] = useState("")
  const [fPhotos,   setFPhotos]   = useState("")   // "any" | "none" | ""
  const [fStatus,   setFStatus]   = useState("")

  const uniqueStatuses = useMemo(() => Array.from(new Set(lots.map(l => l.status))).sort(), [lots])

  const filtered = useMemo(() => lots.filter(l =>
    colMatch(l.lotNumber, fLotNo) &&
    colMatch(l.title, fTitle) &&
    colMatch(l.vendor, fVendor) &&
    colMatch(l.receipt, fReceipt) &&
    colMatch(l.tote, fTote) &&
    colMatch(l.category, fCategory) &&
    (fPhotos === "" || (fPhotos === "any" ? l.imageUrls.length > 0 : l.imageUrls.length === 0)) &&
    (fStatus === "" || l.status === fStatus)
  ), [lots, fLotNo, fTitle, fVendor, fReceipt, fTote, fCategory, fPhotos, fStatus])

  const filtersActive = [fLotNo, fTitle, fVendor, fReceipt, fTote, fCategory, fPhotos, fStatus].some(f => f !== "")

  function clearFilters() {
    setFLotNo(""); setFTitle(""); setFVendor(""); setFReceipt("")
    setFTote(""); setFCategory(""); setFPhotos(""); setFStatus("")
  }

  function exportExcel() {
    const rows = filtered.map(l => ({
      "Lot No.":      l.lotNumber,
      "Title":        l.title,
      "Description":  l.description,
      "Estimate Low": l.estimateLow ?? "",
      "Estimate High":l.estimateHigh ?? "",
      "Starting Bid": l.startingBid ?? "",
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
      "Photos":       l.imageUrls.length,
      "Added By":     l.createdByName ?? "",
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Lots")
    XLSX.writeFile(wb, `${auction.code}_${auction.name}_lots.xlsx`.replace(/\s+/g, "_"))
  }

  function exportForAHK() {
    // Group filtered lots by tote, collect barcodes per tote, skip lots with no tote
    const toteMap = new Map<string, string[]>()
    for (const l of filtered) {
      if (!l.tote?.trim()) continue
      const tote = l.tote.trim()
      if (!toteMap.has(tote)) toteMap.set(tote, [])
      toteMap.get(tote)!.push(l.lotNumber.trim())
    }
    if (toteMap.size === 0) { alert("No lots with tote numbers in current filter."); return }
    const lines = ["ToteNumber,LotCount,Barcodes", ...Array.from(toteMap.entries()).map(([t, barcodes]) => `${t},${barcodes.length},${barcodes.join("|")}`)]
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href     = url
    a.download = "bc_import.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportPhotos() {
    const lotsWithPhotos = filtered.filter(l => l.imageUrls.length > 0)
    if (lotsWithPhotos.length === 0) { setPhotoMsg("No photos to export"); setTimeout(() => setPhotoMsg(null), 3000); return }

    setPhotoExporting(true)
    setPhotoMsg(`Fetching photos for ${lotsWithPhotos.length} lots…`)

    try {
      const zip = new JSZip()
      let fetched = 0

      for (const lot of lotsWithPhotos) {
        const folder = zip.folder(lot.lotNumber)!

        for (let i = 0; i < lot.imageUrls.length; i++) {
          const key = lot.imageUrls[i]
          try {
            const res = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`)
            if (!res.ok) continue
            const blob = await res.blob()
            const ext  = key.split(".").pop() ?? "jpg"
            folder.file(`photo_${i + 1}.${ext}`, blob)
          } catch { /* skip failed images */ }
        }

        fetched++
        setPhotoMsg(`Downloading… ${fetched} / ${lotsWithPhotos.length} lots`)
      }

      setPhotoMsg("Building zip…")
      const content = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(content)
      const a   = document.createElement("a")
      a.href     = url
      a.download = `${auction.code}_photos.zip`.replace(/\s+/g, "_")
      a.click()
      URL.revokeObjectURL(url)
      setPhotoMsg(`✓ Downloaded photos for ${fetched} lots`)
    } catch (e) {
      setPhotoMsg("Export failed")
    } finally {
      setPhotoExporting(false)
      setTimeout(() => setPhotoMsg(null), 4000)
    }
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

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} selected lot${selected.size !== 1 ? "s" : ""}? This cannot be undone.`)) return
    setBulkDeleting(true)
    start(async () => {
      for (const id of selected) await deleteLot(id, auctionId)
      setSelected(new Set())
      setBulkDeleting(false)
      onDelete()
    })
  }

  async function handleGenerateTitles() {
    if (selected.size === 0) return
    startTitles(async () => {
      await generateTitlesFromDescriptions(auctionId, Array.from(selected))
      setTitlesMsg(`✓ Titles generated for ${selected.size} lot${selected.size !== 1 ? "s" : ""}`)
      setSelected(new Set())
      onDelete()
      setTimeout(() => setTitlesMsg(null), 3000)
    })
  }

  function getSortedLotIds(): string[] {
    const sortKey = (l: Lot) => {
      const a = l.subCategory?.toLowerCase() ?? "zzz"
      const b = l.vendor?.toLowerCase() ?? "zzz"
      if (sortMode === "subcat")         return `${a}|||${b}`
      if (sortMode === "vendor")         return `${b}|||${a}`
      if (sortMode === "subcat_vendor")  return `${a}|||${b}`
      return `${b}|||${a}` // vendor_subcat
    }
    return [...lots].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map(l => l.id)
  }

  function getAutoLotterPreview() {
    const sorted = getSortedLotIds().map(id => lots.find(l => l.id === id)!)
    const groups: Record<string, number> = {}
    for (const l of sorted) {
      const key = sortMode === "vendor" || sortMode === "vendor_subcat"
        ? (l.vendor ?? "(no vendor)")
        : (l.subCategory ?? "(no sub-category)")
      groups[key] = (groups[key] ?? 0) + 1
    }
    return groups
  }

  function handleAssignLotNumbers() {
    if (!confirm(`This will renumber all ${lots.length} lots starting from 1. Continue?`)) return
    const orderedIds = getSortedLotIds()
    startLotter(async () => {
      await assignLotNumbers(auctionId, orderedIds)
      setLotterMsg(`✓ ${lots.length} lots renumbered`)
      setShowAutolotter(false)
      onDelete()
      setTimeout(() => setLotterMsg(null), 3000)
    })
  }

  function handleSetStartingBids() {
    const eligible = (selected.size > 0 ? lots.filter(l => selected.has(l.id)) : lots)
      .filter(l => l.estimateLow != null)
    if (eligible.length === 0) { setBidsMsg("No lots with estimates to update."); return }
    const updates = eligible.map(l => ({
      id:         l.id,
      startingBid: roundUpToIncrement(Math.ceil(l.estimateLow! * bidPct / 100)),
    }))
    startBids(async () => {
      await setStartingBids(auctionId, updates)
      setBidsMsg(`✓ Starting bids set for ${updates.length} lot${updates.length !== 1 ? "s" : ""}`)
      setShowBids(false)
      setSelected(new Set())
      onDelete()
      setTimeout(() => setBidsMsg(null), 3000)
    })
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)))
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
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setFillMsg(null)
              startFill(async () => {
                const result = await fillLotsFromTotes(auctionId)
                setFillMsg(result.updated > 0 ? `✓ Updated ${result.updated} lot${result.updated !== 1 ? "s" : ""}` : "No lots needed updating")
                setTimeout(() => setFillMsg(null), 3000)
                onDelete()
              })
            }}
            disabled={fillPending}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:border-[#2AB4A6] hover:text-[#2AB4A6] transition-colors disabled:opacity-50"
          >
            {fillPending ? "Pulling…" : "⟳ Pull Vendor/Receipt from Totes"}
          </button>
          <button
            onClick={() => { setShowAutolotter(v => !v); setShowBids(false) }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${showAutolotter ? "border-yellow-500 text-yellow-400 bg-yellow-900/20" : "border-gray-600 text-gray-400 hover:border-yellow-500 hover:text-yellow-400"}`}>
            🔢 Auto-number Lots
          </button>
          <button
            onClick={() => { setShowBids(v => !v); setShowAutolotter(false) }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${showBids ? "border-green-500 text-green-400 bg-green-900/20" : "border-gray-600 text-gray-400 hover:border-green-500 hover:text-green-400"}`}>
            💰 Set Starting Bids
          </button>
          {fillMsg  && <span className="text-xs text-[#2AB4A6]">{fillMsg}</span>}
          {lotterMsg && <span className="text-xs text-yellow-400">{lotterMsg}</span>}
          {bidsMsg  && <span className="text-xs text-green-400">{bidsMsg}</span>}
          {titlesMsg && <span className="text-xs text-[#2AB4A6]">{titlesMsg}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <>
              <button onClick={handleGenerateTitles} disabled={titlesPending}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-blue-700 text-blue-400 hover:bg-blue-900/30 transition-colors disabled:opacity-50">
                {titlesPending ? "Generating…" : `✏️ Generate Titles (${selected.size})`}
              </button>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-red-700 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50">
                {bulkDeleting ? "Deleting…" : `🗑 Delete ${selected.size} selected`}
              </button>
            </>
          )}
          {filtersActive && (
            <span className="text-xs text-gray-500">
              {filtered.length} / {lots.length} lots
              <button onClick={clearFilters} className="ml-2 text-[#2AB4A6] hover:underline">clear</button>
            </span>
          )}
          <button onClick={exportForAHK}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:border-purple-400 hover:text-purple-400 transition-colors">
            ⬇ Export for BC Macro
          </button>
          <button onClick={exportPhotos} disabled={photoExporting}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:border-[#2AB4A6] hover:text-[#2AB4A6] transition-colors disabled:opacity-50">
            {photoExporting ? "⏳ Exporting…" : "📷 Export Photos (.zip)"}
          </button>
          <button onClick={exportExcel}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-[#2AB4A6] text-[#2AB4A6] hover:bg-[#2AB4A6] hover:text-black transition-colors">
            ⬇ Export to Excel
          </button>
        </div>
      </div>
      {photoMsg && <p className="text-xs text-[#2AB4A6] mb-2">{photoMsg}</p>}

      {/* ── Auto-number Lots panel ── */}
      {showAutolotter && (
        <div className="mb-4 bg-[#1C1C1E] border border-yellow-700/40 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-yellow-300">Auto-number Lots</p>
          <p className="text-xs text-gray-500">Sorts all {lots.length} lots by the chosen criteria then assigns lot numbers 1, 2, 3… sequentially.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              ["subcat",        "By Sub-Category"],
              ["vendor",        "By Vendor"],
              ["subcat_vendor", "Sub-Cat → Vendor"],
              ["vendor_subcat", "Vendor → Sub-Cat"],
            ] as const).map(([val, label]) => (
              <button key={val} onClick={() => setSortMode(val)}
                className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${
                  sortMode === val ? "border-yellow-500 bg-yellow-900/20 text-yellow-300" : "border-gray-700 text-gray-400 hover:border-gray-500"
                }`}>
                {label}
              </button>
            ))}
          </div>
          {/* Preview groups */}
          <div className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
            {Object.entries(getAutoLotterPreview()).map(([group, count]) => (
              <div key={group} className="flex gap-2">
                <span className="text-yellow-400/70 w-6 text-right">{count}</span>
                <span>{group}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAutolotter(false)}
              className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">
              Cancel
            </button>
            <button onClick={handleAssignLotNumbers} disabled={lotterPending}
              className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              {lotterPending ? "Numbering…" : `Assign lot numbers 1–${lots.length}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Set Starting Bids panel ── */}
      {showBids && (() => {
        const eligible = (selected.size > 0 ? lots.filter(l => selected.has(l.id)) : lots).filter(l => l.estimateLow != null)
        const preview  = eligible.slice(0, 3).map(l => ({
          lotNumber: l.lotNumber,
          low: l.estimateLow!,
          bid: roundUpToIncrement(Math.ceil(l.estimateLow! * bidPct / 100)),
        }))
        return (
          <div className="mb-4 bg-[#1C1C1E] border border-green-700/40 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-green-300">Set Starting Bids</p>
            <p className="text-xs text-gray-500">
              Calculates {bidPct}% of each lot's low estimate, rounded up to the nearest bidding increment.
              {selected.size > 0 ? ` Applies to ${eligible.length} selected lot${eligible.length !== 1 ? "s" : ""} with estimates.` : ` Applies to all ${eligible.length} lots with estimates.`}
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400">Percentage of low estimate:</label>
              <input type="number" min={1} max={100} value={bidPct}
                onChange={e => setBidPct(Math.max(1, Math.min(100, Number(e.target.value))))}
                className="w-20 bg-[#2C2C2E] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 text-center" />
              <span className="text-xs text-gray-600">%</span>
            </div>
            {preview.length > 0 && (
              <div className="text-xs text-gray-500 space-y-1">
                <p className="text-gray-600 uppercase tracking-wider">Preview</p>
                {preview.map(p => (
                  <div key={p.lotNumber} className="flex gap-3">
                    <span className="text-gray-400 font-mono w-10">{p.lotNumber}</span>
                    <span>Low est. £{p.low} → starting bid <span className="text-green-400 font-semibold">£{p.bid}</span></span>
                  </div>
                ))}
                {eligible.length > 3 && <p className="text-gray-600">…and {eligible.length - 3} more</p>}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowBids(false)}
                className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">
                Cancel
              </button>
              <button onClick={handleSetStartingBids} disabled={bidsPending || eligible.length === 0}
                className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                {bidsPending ? "Applying…" : `Set starting bids for ${eligible.length} lots`}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Table */}
      <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-700 bg-[#141416]">
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-600 accent-[#2AB4A6]" />
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Lot No.</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Title</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Vendor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Receipt</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Tote</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Photos</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3" />
            </tr>
            {/* Filter row */}
            <tr className="border-b border-gray-800 bg-[#111113]">
              <td className="px-4 py-1.5" />
              <td className="px-2 py-1.5"><input value={fLotNo}    onChange={e => setFLotNo(e.target.value)}    placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fTitle}    onChange={e => setFTitle(e.target.value)}    placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fVendor}   onChange={e => setFVendor(e.target.value)}   placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fReceipt}  onChange={e => setFReceipt(e.target.value)}  placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fTote}     onChange={e => setFTote(e.target.value)}     placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fCategory} onChange={e => setFCategory(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5">
                <select value={fPhotos} onChange={e => setFPhotos(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  <option value="any">Has photos</option>
                  <option value="none">No photos</option>
                </select>
              </td>
              <td className="px-2 py-1.5">
                <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td />
            </tr>
          </thead>
          <tbody>
            {filtered.map(lot => (
              <tr key={lot.id} className={`border-b border-gray-800 last:border-0 hover:bg-[#2C2C2E] transition-colors cursor-pointer ${selected.has(lot.id) ? "bg-[#2AB4A6]/5" : ""}`} onClick={() => onEdit(lot.id)}>
                <td className="w-8" onClick={e => e.stopPropagation()}>
                  <label className="flex items-center justify-center px-4 py-3 cursor-pointer h-full">
                    <input type="checkbox" checked={selected.has(lot.id)} onChange={() => toggleSelect(lot.id)}
                      className="w-4 h-4 rounded border-gray-600 accent-[#2AB4A6]" />
                  </label>
                </td>
                <td className="px-4 py-3 font-mono font-semibold text-[#2AB4A6] whitespace-nowrap">{lot.lotNumber}</td>
                <td className="px-4 py-3 text-gray-200 max-w-[160px] truncate">{lot.title || <span className="text-gray-600 italic">Uncatalogued</span>}</td>
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{lot.vendor ?? "—"}</td>
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{lot.receipt ?? "—"}</td>
                <td className="px-4 py-3 text-gray-400 text-xs font-mono whitespace-nowrap">{lot.tote ?? "—"}</td>
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
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-600 text-sm">No lots match your filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Lot edit view (inside manage-lots tab) ───────────────────────────────────

const PARCEL_OPTIONS = ["Small", "Medium", "Large", "Contact", "Collection Only"]

function LotEditView({ lot, auctionId, onDone }: { lot: Lot | null; auctionId: string; onDone: () => void }) {
  const [pending, start]             = useTransition()
  const [imageKeys, setImageKeys]    = useState<string[]>(lot?.imageUrls ?? [])
  const [signedUrls, setSignedUrls]  = useState<Record<string, string>>({})
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  const [titleVal, setTitleVal] = useState(lot?.title ?? "")

  // Parse stored condition "Good to Excellent" → cond1="Good", cond2="Excellent"
  const condParts = (lot?.condition ?? "").split(" to ")
  const [cond1, setCond1] = useState(condParts[0] ?? "")
  const [cond2, setCond2] = useState(condParts[1] ?? "")
  const condValue = [cond1, cond2].filter(Boolean).sort((a, b) => CONDITIONS.indexOf(a) - CONDITIONS.indexOf(b)).join(" to ")

  // Parcel size is stored in notes
  const [parcel, setParcel] = useState(lot?.notes ?? "")

  // Category / sub-category / brand
  const [mainCat,  setMainCat]  = useState(lot?.category ?? "")
  const [subCat,   setSubCat]   = useState(lot?.subCategory ?? "")
  const [brand,    setBrand]    = useState(lot?.brand ?? "")
  const [brandSearch, setBrandSearch] = useState(lot?.brand ?? "")
  const [brandFocused, setBrandFocused] = useState(false)
  const mainCatList = Object.keys(CATEGORY_MAP).sort()
  const subCatList  = mainCat ? (CATEGORY_MAP[mainCat] ?? []) : []
  const filteredBrands = useMemo(() =>
    brandSearch.trim().length < 2
      ? []
      : BRANDS_LIST.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase())).slice(0, 10),
    [brandSearch]
  )

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
              <div className="flex items-center justify-between mb-1">
                <label className={lbl} style={{margin:0}}>Title *</label>
                <span className={`text-xs ${titleVal.length > TITLE_LIMIT ? "text-red-400" : titleVal.length > TITLE_LIMIT * 0.9 ? "text-yellow-400" : "text-gray-600"}`}>
                  {titleVal.length}/{TITLE_LIMIT}
                </span>
              </div>
              <input name="title" required value={titleVal} onChange={e => setTitleVal(e.target.value.slice(0, TITLE_LIMIT))}
                maxLength={TITLE_LIMIT} className={input} />
            </div>
            <div>
              <label className={lbl}>Description</label>
              <textarea name="description" rows={4} defaultValue={lot.description}
                className={`${input} resize-none`} />
            </div>
            <div>
              <label className={lbl}>Condition</label>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {CONDITIONS.map(c => (
                  <button key={c} type="button" onClick={() => setCond1(v => v === c ? "" : c)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${cond1 === c ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-400 hover:border-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
              <label className={`${lbl} mt-2`}>Condition To <span className="text-gray-600">(optional)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {CONDITIONS.map(c => (
                  <button key={c} type="button" onClick={() => setCond2(v => v === c ? "" : c)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${cond2 === c ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-400 hover:border-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
              {condValue && <p className="text-xs text-[#2AB4A6] mt-1">{condValue}</p>}
              <input type="hidden" name="condition" value={condValue} />
            </div>
            <div>
              <label className={lbl}>Status</label>
              <select name="status" defaultValue={lot.status} className={input}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Parcel Size</label>
              <div className="flex flex-wrap gap-1.5">
                {PARCEL_OPTIONS.map(opt => (
                  <button key={opt} type="button" onClick={() => setParcel(v => v === opt ? "" : opt)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${parcel === opt ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-400 hover:border-gray-500"}`}>
                    {opt}
                  </button>
                ))}
              </div>
              <input type="hidden" name="notes" value={parcel} />
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
                <label className={lbl}>Starting Bid (£)</label>
                <input name="startingBid" type="number" min="0" defaultValue={lot.startingBid ?? ""} className={input} />
              </div>
              <div>
                <label className={lbl}>Reserve (£)</label>
                <input name="reserve" type="number" min="0" defaultValue={lot.reserve ?? ""} className={input} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Hammer Price (£)</label>
                <input name="hammerPrice" type="number" min="0" defaultValue={lot.hammerPrice ?? ""} className={input} />
              </div>
              <div />
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
              <select value={mainCat} onChange={e => { setMainCat(e.target.value); setSubCat("") }} className={input}>
                <option value="">— Select —</option>
                {mainCatList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="hidden" name="category" value={mainCat} />
            </div>
            <div>
              <label className={lbl}>Sub-Category</label>
              <select value={subCat} onChange={e => setSubCat(e.target.value)} className={input} disabled={!mainCat}>
                <option value="">— Select —</option>
                {subCatList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="hidden" name="subCategory" value={subCat} />
            </div>
            <div className="relative">
              <label className={lbl}>Brand</label>
              <input
                value={brandSearch}
                onChange={e => { setBrandSearch(e.target.value); setBrand(e.target.value) }}
                onFocus={() => setBrandFocused(true)}
                onBlur={() => setTimeout(() => setBrandFocused(false), 150)}
                placeholder="Search brand…"
                className={input}
                autoComplete="off"
              />
              <input type="hidden" name="brand" value={brand} />
              {brandFocused && filteredBrands.length > 0 && (
                <ul className="absolute z-10 w-full mt-1 bg-[#1C1C1E] border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                  {filteredBrands.map(b => (
                    <li key={b}>
                      <button type="button" onClick={() => { setBrand(b); setBrandSearch(b) }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-[#2C2C2E] transition-colors">
                        {b}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
