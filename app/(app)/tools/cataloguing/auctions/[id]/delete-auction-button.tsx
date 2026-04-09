"use client"

import { useRouter } from "next/navigation"
import { deleteAuction } from "@/lib/actions/catalogue"

export default function DeleteAuctionButton({ id }: { id: string }) {
  const router = useRouter()

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this auction? All lots will also be deleted.")) return
    await deleteAuction(id)
    router.push("/tools/cataloguing/auctions")
  }

  return (
    <button
      onClick={handleDelete}
      className="w-full mt-2 rounded-lg border border-red-700 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm font-medium px-4 py-2 transition-colors"
    >
      Delete Auction
    </button>
  )
}
