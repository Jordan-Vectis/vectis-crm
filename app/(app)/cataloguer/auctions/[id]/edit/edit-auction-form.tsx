"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { updateAuction } from "@/lib/actions/catalogue"

const AUCTION_TYPES = [
  { value: "GENERAL", label: "General" },
  { value: "DIECAST", label: "Diecast" },
  { value: "TRAINS", label: "Trains" },
  { value: "VINYL", label: "Vinyl" },
  { value: "TV_FILM", label: "TV & Film" },
  { value: "MATCHBOX", label: "Matchbox" },
  { value: "COMICS", label: "Comics" },
  { value: "BEARS", label: "Bears" },
  { value: "DOLLS", label: "Dolls" },
]

interface Auction {
  id: string
  code: string
  name: string
  auctionDate: Date | null
  auctionType: string
  eventName: string | null
  locked: boolean
  finished: boolean
  complete: boolean
  notes: string | null
}

export default function EditAuctionForm({ auction }: { auction: Auction }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const defaultDate = auction.auctionDate
    ? new Date(auction.auctionDate).toISOString().split("T")[0]
    : ""

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    try {
      const fd = new FormData(e.currentTarget)
      await updateAuction(auction.id, fd)
      router.push(`/cataloguer/auctions/${auction.id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Code *</label>
          <input
            name="code"
            required
            defaultValue={auction.code}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
          <input
            name="auctionDate"
            type="date"
            defaultValue={defaultDate}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
        <input
          name="name"
          required
          defaultValue={auction.name}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
          <select
            name="auctionType"
            defaultValue={auction.auctionType}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AUCTION_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Event Name</label>
          <input
            name="eventName"
            defaultValue={auction.eventName ?? ""}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="locked"
            value="true"
            defaultChecked={auction.locked}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">Locked</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="finished"
            value="true"
            defaultChecked={auction.finished}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">Finished</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="complete"
            value="true"
            defaultChecked={auction.complete}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">Complete</span>
        </label>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.push(`/cataloguer/auctions/${auction.id}`)}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  )
}
