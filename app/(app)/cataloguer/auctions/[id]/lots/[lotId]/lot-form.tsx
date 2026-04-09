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
      router.push(`/cataloguer/auctions/${auctionId}`)
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
      router.push(`/cataloguer/auctions/${auctionId}`)
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Lot Number *</label>
            <input
              name="lotNumber"
              required
              defaultValue={lot?.lotNumber ?? ""}
              placeholder="e.g. 001"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input
              name="title"
              required
              defaultValue={lot?.title ?? ""}
              placeholder="Lot title"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea
              name="description"
              rows={4}
              defaultValue={lot?.description ?? ""}
              placeholder="Detailed description..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Condition</label>
            <select
              name="condition"
              defaultValue={lot?.condition ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select condition —</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select
              name="status"
              defaultValue={lot?.status ?? "ENTERED"}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={lot?.notes ?? ""}
              placeholder="Internal notes..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Estimate Low (£)</label>
              <input
                name="estimateLow"
                type="number"
                min="0"
                defaultValue={lot?.estimateLow ?? ""}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Estimate High (£)</label>
              <input
                name="estimateHigh"
                type="number"
                min="0"
                defaultValue={lot?.estimateHigh ?? ""}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reserve (£)</label>
              <input
                name="reserve"
                type="number"
                min="0"
                defaultValue={lot?.reserve ?? ""}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Hammer Price (£)</label>
              <input
                name="hammerPrice"
                type="number"
                min="0"
                defaultValue={lot?.hammerPrice ?? ""}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label>
            <input
              name="vendor"
              defaultValue={lot?.vendor ?? ""}
              placeholder="Vendor name"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tote</label>
              <input
                name="tote"
                defaultValue={lot?.tote ?? ""}
                placeholder="Tote reference"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Receipt</label>
              <input
                name="receipt"
                defaultValue={lot?.receipt ?? ""}
                placeholder="Receipt no."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <input
              name="category"
              defaultValue={lot?.category ?? ""}
              placeholder="Category"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sub-Category</label>
            <input
              name="subCategory"
              defaultValue={lot?.subCategory ?? ""}
              placeholder="Sub-category"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Brand</label>
            <input
              name="brand"
              defaultValue={lot?.brand ?? ""}
              placeholder="Brand"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={() => router.push(`/cataloguer/auctions/${auctionId}`)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors"
        >
          {loading ? "Saving..." : isNew ? "Create Lot" : "Save Changes"}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="ml-auto rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium px-4 py-2 transition-colors"
          >
            Delete Lot
          </button>
        )}
      </div>
    </form>
  )
}
