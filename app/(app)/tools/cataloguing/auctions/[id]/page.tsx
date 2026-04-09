import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import DeleteAuctionButton from "./delete-auction-button"

const STATUS_STYLES: Record<string, string> = {
  ENTERED:   "bg-gray-100 text-gray-700",
  REVIEWED:  "bg-blue-100 text-blue-700",
  PUBLISHED: "bg-green-100 text-green-700",
  SOLD:      "bg-emerald-100 text-emerald-700",
  UNSOLD:    "bg-red-100 text-red-700",
  WITHDRAWN: "bg-orange-100 text-orange-700",
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
        <Link href="/tools/cataloguing/auctions" className="text-sm text-blue-600 hover:text-blue-800">
          ← Back to Auctions
        </Link>
      </div>

      <div className="flex gap-6">
        {/* Lots table — 70% */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Lots</h2>
              <Link
                href={`/tools/cataloguing/auctions/${id}/lots/new`}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                + Add Lot
              </Link>
            </div>
            {auction.lots.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                No lots yet. Add the first lot.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Lot No.</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Estimate</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Condition</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {auction.lots.map((lot) => (
                    <tr
                      key={lot.id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/tools/cataloguing/auctions/${id}/lots/${lot.id}`}
                          className="font-mono text-blue-600 hover:text-blue-800 font-medium"
                        >
                          {lot.lotNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-900 max-w-xs truncate">{lot.title}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {lot.estimateLow && lot.estimateHigh
                          ? `£${lot.estimateLow.toLocaleString("en-GB")}–£${lot.estimateHigh.toLocaleString("en-GB")}`
                          : lot.estimateLow
                          ? `£${lot.estimateLow.toLocaleString("en-GB")}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{lot.condition ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_STYLES[lot.status] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {lot.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/tools/cataloguing/auctions/${id}/lots/${lot.id}`}
                          className="text-xs text-gray-400 hover:text-gray-700"
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
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <p className="font-mono font-bold text-lg text-gray-900">{auction.code}</p>
              <p className="text-sm text-gray-600 mt-0.5">{auction.name}</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="text-gray-900">{auction.auctionType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date</span>
                <span className="text-gray-900">
                  {auction.auctionDate
                    ? new Date(auction.auctionDate).toLocaleDateString("en-GB")
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Event</span>
                <span className="text-gray-900">{auction.eventName ?? "—"}</span>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Locked</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${auction.locked ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"}`}>
                  {auction.locked ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Finished</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${auction.finished ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"}`}>
                  {auction.finished ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Complete</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${auction.complete ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                  {auction.complete ? "Yes" : "No"}
                </span>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Total Lots</span>
                <span className="font-semibold text-gray-900">{totalLots}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Est. Low</span>
                <span className="font-semibold text-gray-900">{fmtGBP(totalEstLow)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Est. High</span>
                <span className="font-semibold text-gray-900">{fmtGBP(totalEstHigh)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Reserve</span>
                <span className="font-semibold text-gray-900">{fmtGBP(totalReserve)}</span>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-2">
              <Link
                href={`/tools/cataloguing/auctions/${id}/edit`}
                className="block w-full text-center rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 transition-colors"
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
