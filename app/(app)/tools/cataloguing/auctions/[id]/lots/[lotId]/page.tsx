import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import LotForm from "./lot-form"

export default async function LotPage({
  params,
}: {
  params: Promise<{ id: string; lotId: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

  const { id, lotId } = await params

  const auction = await prisma.catalogueAuction.findUnique({
    where: { id },
    select: { id: true, code: true, name: true },
  })
  if (!auction) notFound()

  let lot = null
  if (lotId !== "new") {
    lot = await prisma.catalogueLot.findUnique({ where: { id: lotId } })
    if (!lot) notFound()
  }

  const isNew = lotId === "new"

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link
          href={`/tools/cataloguing/auctions/${id}`}
          className="text-sm text-[#2AB4A6] hover:text-[#24a090]"
        >
          ← Back to Auction
        </Link>
        <span className="text-gray-600 text-sm mx-2">/</span>
        <span className="text-sm text-gray-500 font-mono">{auction.code}</span>
      </div>

      <div className="bg-[#1C1C1E] rounded-xl border border-gray-700 p-6">
        <h1 className="text-xl font-bold text-white mb-6">
          {isNew ? "Add Lot" : `Edit Lot — ${lot?.lotNumber}`}
        </h1>
        <LotForm auctionId={id} lot={lot} />
      </div>
    </div>
  )
}
