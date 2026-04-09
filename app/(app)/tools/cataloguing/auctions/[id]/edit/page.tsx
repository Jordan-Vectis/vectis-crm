import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import EditAuctionForm from "./edit-auction-form"

export default async function EditAuctionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

  const { id } = await params

  const auction = await prisma.catalogueAuction.findUnique({ where: { id } })
  if (!auction) notFound()

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-4">
        <Link
          href={`/tools/cataloguing/auctions/${id}`}
          className="text-sm text-[#2AB4A6] hover:text-[#24a090]"
        >
          ← Back to Auction
        </Link>
      </div>

      <div className="bg-[#1C1C1E] rounded-xl border border-gray-700 p-6">
        <h1 className="text-xl font-bold text-white mb-6">
          Edit Auction — <span className="font-mono">{auction.code}</span>
        </h1>
        <EditAuctionForm auction={auction} />
      </div>
    </div>
  )
}
