"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createLot, updateLot, deleteLot } from "@/lib/actions/catalogue"

interface Lot {
  id: string
  lotNumber: string
  title: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  reserve: number | null
  hammerPrice: number | null
  condition: string | null
  vendor: string | null
  tote: string | null
  receipt: string | null
  category: string | null
  subCategory: string | null
  brand: string | null
  notes: string | null
  status: string
}

const CONDITIONS = ["Mint", "Near Mint", "Excellent", "Good", "Fair", "Poor"]
const STATUSES = ["ENTERED", "REVIEWED", "PUBLISHED", "SOLD", "UNSOLD", "WITHDRAWN"]

const inputClass = "w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
const labelClass = "block text-xs font-medium text-gray-400 mb-1"

export default function LotForm({
  auctionId,
  lot,
}: {
  auctionId: string
  lot: Lot | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const isNew = lot === null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    try {
      const fd = new FormData(e.currentTarget)
      if (isNew) {
        await createLot(auctionId, fd)
      } else {
        await updateLot(lot.id, auctionId, fd)
      }
      router.push(`/tools/cataloguing/auctions/${auctionId}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!lot) return
    if (!confirm("Delete this lot?")) return
    setLoading(true)
    try {
      await deleteLot(lot.id, auctionId)
      router.push(`/tools/cataloguing/auctions/${auctionId}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Lot Number *</label>
            <input
              name="lotNumber"
              required
              defaultValue={lot?.lotNumber ?? ""}
              placeholder="e.g. 001"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Title *</label>
            <input
              name="title"
              required
              defaultValue={lot?.title ?? ""}
              placeholder="Lot title"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <textarea
              name="description"
              rows={4}
              defaultValue={lot?.description ?? ""}
              placeholder="Detailed description..."
              className={`${inputClass} resize-none`}
            />
          </div>
          <div>
            <label className={labelClass}>Condition</label>
            <select
              name="condition"
              defaultValue={lot?.condition ?? ""}
              className={inputClass}
            >
              <option value="">— Select condition —</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select
              name="status"
              defaultValue={lot?.status ?? "ENTERED"}
              className={inputClass}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Notes</label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={lot?.notes ?? ""}
              placeholder="Internal notes..."
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Estimate Low (£)</label>
              <input
                name="estimateLow"
                type="number"
                min="0"
                defaultValue={lot?.estimateLow ?? ""}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Estimate High (£)</label>
              <input
                name="estimateHigh"
                type="number"
                min="0"
                defaultValue={lot?.estimateHigh ?? ""}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Reserve (£)</label>
              <input
                name="reserve"
                type="number"
                min="0"
                defaultValue={lot?.reserve ?? ""}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Hammer Price (£)</label>
              <input
                name="hammerPrice"
                type="number"
                min="0"
                defaultValue={lot?.hammerPrice ?? ""}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Vendor</label>
            <input
              name="vendor"
              defaultValue={lot?.vendor ?? ""}
              placeholder="Vendor name"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Tote</label>
              <input
                name="tote"
                defaultValue={lot?.tote ?? ""}
                placeholder="Tote reference"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Receipt</label>
              <input
                name="receipt"
                defaultValue={lot?.receipt ?? ""}
                placeholder="Receipt no."
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <input
              name="category"
              defaultValue={lot?.category ?? ""}
              placeholder="Category"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Sub-Category</label>
            <input
              name="subCategory"
              defaultValue={lot?.subCategory ?? ""}
              placeholder="Sub-category"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Brand</label>
            <input
              name="brand"
              defaultValue={lot?.brand ?? ""}
              placeholder="Brand"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-700">
        <button
          type="button"
          onClick={() => router.push(`/tools/cataloguing/auctions/${auctionId}`)}
          className="rounded-lg border border-gray-700 bg-[#2C2C2E] px-4 py-2 text-sm font-medium text-gray-400 hover:bg-[#3C3C3E] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-white font-semibold text-sm px-6 py-2 rounded-lg transition-colors"
        >
          {loading ? "Saving..." : isNew ? "Create Lot" : "Save Changes"}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="ml-auto rounded-lg border border-red-700 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm font-medium px-4 py-2 transition-colors"
          >
            Delete Lot
          </button>
        )}
      </div>
    </form>
  )
}
