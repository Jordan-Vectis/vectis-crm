import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import DeleteAuctionButton from "./delete-auction-button"

const STATUS_STYLES: Record<string, string> = {
  ENTERED:   "bg-gray-700 text-gray-300",
  REVIEWED:  "bg-blue-900/50 text-blue-300",
  PUBLISHED: "bg-green-900/50 text-green-300",
  SOLD:      "bg-emerald-900/50 text-emerald-300",
  UNSOLD:    "bg-red-900/50 text-red-300",
  WITHDRAWN: "bg-orange-900/50 text-orange-300",
}

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

  const { id } = await params

  const auction = await prisma.catalogueAuction.findUnique({
    where: { id },
    include: {
      lots: { orderBy: { lotNumber: "asc" } },
    },
  })

  if (!auction) notFound()

  const totalLots = auction.lots.length
  const totalEstLow = auction.lots.reduce((s, l) => s + (l.estimateLow ?? 0), 0)
  const totalEstHigh = auction.lots.reduce((s, l) => s + (l.estimateHigh ?? 0), 0)
  const totalReserve = auction.lots.reduce((s, l) => s + (l.reserve ?? 0), 0)

  const fmtGBP = (n: number) =>
    n > 0 ? `£${n.toLocaleString("en-GB")}` : "—"

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link href="/tools/cataloguing/auctions" className="text-sm text-[#2AB4A6] hover:text-[#24a090]">
          ← Back to Auctions
        </Link>
      </div>

      <div className="flex gap-6">
        {/* Lots table — 70% */}
        <div className="flex-1 min-w-0">
          <div className="bg-[#1C1C1E] rounded-xl border border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <h2 className="font-semibold text-gray-100">Lots</h2>
              <Link
                href={`/tools/cataloguing/auctions/${id}/lots/new`}
                className="bg-[#2AB4A6] hover:bg-[#24a090] text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors"
              >
                + Add Lot
              </Link>
            </div>
            {auction.lots.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                No lots yet. Add the first lot.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                    <th className="text-left px-4 py-3 font-medium text-gray-400">Lot No.</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-400">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-400">Estimate</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-400">Condition</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-400">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {auction.lots.map((lot) => (
                    <tr
                      key={lot.id}
                      className="border-b border-gray-800 last:border-0 hover:bg-[#1C1C1E] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/tools/cataloguing/auctions/${id}/lots/${lot.id}`}
                          className="font-mono text-[#2AB4A6] hover:text-[#24a090] font-medium"
                        >
                          {lot.lotNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-100 max-w-xs truncate">{lot.title}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {lot.estimateLow && lot.estimateHigh
                          ? `£${lot.estimateLow.toLocaleString("en-GB")}–£${lot.estimateHigh.toLocaleString("en-GB")}`
                          : lot.estimateLow
                          ? `£${lot.estimateLow.toLocaleString("en-GB")}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-400">{lot.condition ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_STYLES[lot.status] ?? "bg-gray-700 text-gray-300"
                          }`}
                        >
                          {lot.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/tools/cataloguing/auctions/${id}/lots/${lot.id}`}
                          className="text-xs text-gray-500 hover:text-gray-300"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Stats sidebar — 30% */}
        <div className="w-72 flex-shrink-0">
          <div className="bg-[#1C1C1E] rounded-xl border border-gray-700 p-5 space-y-4">
            <div>
              <p className="font-mono font-bold text-lg text-gray-100">{auction.code}</p>
              <p className="text-sm text-gray-400 mt-0.5">{auction.name}</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Type</span>
                <span className="text-gray-100">{auction.auctionType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Date</span>
                <span className="text-gray-100">
                  {auction.auctionDate
                    ? new Date(auction.auctionDate).toLocaleDateString("en-GB")
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Event</span>
                <span className="text-gray-100">{auction.eventName ?? "—"}</span>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Locked</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${auction.locked ? "bg-blue-900/50 text-blue-300" : "bg-gray-700 text-gray-400"}`}>
                  {auction.locked ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Finished</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${auction.finished ? "bg-blue-900/50 text-blue-300" : "bg-gray-700 text-gray-400"}`}>
                  {auction.finished ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Complete</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${auction.complete ? "bg-green-900/50 text-green-300" : "bg-gray-700 text-gray-400"}`}>
                  {auction.complete ? "Yes" : "No"}
                </span>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Lots</span>
                <span className="font-semibold text-gray-100">{totalLots}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Est. Low</span>
                <span className="font-semibold text-gray-100">{fmtGBP(totalEstLow)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Est. High</span>
                <span className="font-semibold text-gray-100">{fmtGBP(totalEstHigh)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Reserve</span>
                <span className="font-semibold text-gray-100">{fmtGBP(totalReserve)}</span>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-3 space-y-2">
              <Link
                href={`/tools/cataloguing/auctions/${id}/edit`}
                className="block w-full text-center rounded-lg bg-[#2AB4A6] hover:bg-[#24a090] text-white font-semibold text-sm px-4 py-2 transition-colors"
              >
                Edit Auction
              </Link>
              <DeleteAuctionButton id={id} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
