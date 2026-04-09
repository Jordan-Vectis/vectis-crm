import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import NewAuctionButton from "./new-auction-button"

export default async function AuctionsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

  const auctions = await prisma.catalogueAuction.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { lots: true } } },
  })

  const totalLots = auctions.reduce((sum, a) => sum + a._count.lots, 0)
  const activeAuctions = auctions.filter(a => !a.complete && !a.finished).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Auctions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage catalogue auctions and lots</p>
        </div>
        <NewAuctionButton />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Auctions</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{auctions.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{activeAuctions}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Lots</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalLots}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {auctions.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No auctions yet. Create the first one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Code</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Lots</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Locked</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Finished</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Complete</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Event Name</th>
              </tr>
            </thead>
            <tbody>
              {auctions.map((auction) => (
                <tr
                  key={auction.id}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/cataloguer/auctions/${auction.id}`}
                      className="font-mono font-semibold text-blue-600 hover:text-blue-800"
                    >
                      {auction.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{auction.name}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {auction.auctionDate
                      ? new Date(auction.auctionDate).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{auction.auctionType}</td>
                  <td className="px-4 py-3 text-gray-500">{auction._count.lots}</td>
                  <td className="px-4 py-3 text-center">
                    {auction.locked ? (
                      <span className="text-green-600 font-bold">✓</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {auction.finished ? (
                      <span className="text-green-600 font-bold">✓</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {auction.complete ? (
                      <span className="text-green-600 font-bold">✓</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{auction.eventName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
