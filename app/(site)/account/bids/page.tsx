import { getCustomerSession } from "@/lib/customer-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"

export const metadata = { title: "My Bids — Vectis" }

export default async function MyBidsPage() {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  // Check for any active live auction the customer can join
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: true },
  })

  // Upcoming auctions to encourage bidding
  const upcoming = await prisma.catalogueAuction.findMany({
    where: { published: true, finished: false, complete: false },
    orderBy: { auctionDate: "asc" },
    take: 3,
    select: { id: true, name: true, code: true, auctionDate: true, _count: { select: { lots: true } } },
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">My Bids</h1>
      <p className="text-sm text-gray-500 mb-6">Your bidding history and active bids.</p>

      {/* Live auction alert */}
      {liveAuction && (
        <div className="mb-6 bg-red-50 border border-red-300 rounded-xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
            <div>
              <p className="font-bold text-red-800 text-sm">Auction Live Now: {liveAuction.auction.name}</p>
              <p className="text-red-600 text-xs mt-0.5">Join the live bidding room to place bids in real time</p>
            </div>
          </div>
          <Link
            href={`/auctions/${liveAuction.auction.code}/live`}
            className="shrink-0 bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-widest px-5 py-2.5 transition-colors"
          >
            BID LIVE →
          </Link>
        </div>
      )}

      {/* No bid history yet */}
      <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm mb-6">
        <div className="text-center py-4">
          <div className="w-16 h-16 bg-[#1e3058]/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#1e3058]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-gray-700 font-semibold text-lg mb-2">No bids placed yet</p>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Browse our upcoming auctions and join the live bidding room when an auction goes live. Your bid history will appear here.
          </p>
        </div>
      </div>

      {/* How to bid */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-6">
        <h2 className="font-bold text-gray-800 text-base mb-4">How to Bid at Vectis</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { step: "1", title: "Browse the Catalogue", desc: "Find lots you want in our upcoming auction catalogues." },
            { step: "2", title: "Join the Live Room", desc: "When the auction goes live, enter the bidding room and bid in real time." },
            { step: "3", title: "Win & Collect", desc: "If you win, our team will contact you to arrange payment and delivery." },
          ].map(s => (
            <div key={s.step} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[#1e3058] text-white text-sm font-black flex items-center justify-center shrink-0">
                {s.step}
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm mb-1">{s.title}</p>
                <p className="text-gray-500 text-xs leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming auctions */}
      {upcoming.length > 0 && (
        <div>
          <h2 className="font-bold text-gray-800 text-base mb-3">Upcoming Auctions</h2>
          <div className="space-y-3">
            {upcoming.map(a => (
              <div key={a.id} className="bg-white border border-gray-200 rounded-xl px-5 py-4 shadow-sm flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{a.name}</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {a.auctionDate
                      ? new Date(a.auctionDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
                      : "Date TBC"}
                    {" · "}{a._count.lots} lots
                  </p>
                </div>
                <Link
                  href={`/auctions/${a.code}`}
                  className="bg-[#1e3058] hover:bg-[#162544] text-white text-xs font-black uppercase tracking-wider px-4 py-2 transition-colors shrink-0"
                >
                  VIEW CATALOGUE
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
