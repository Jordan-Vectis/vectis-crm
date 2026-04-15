import { getCustomerSession } from "@/lib/customer-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { lotPhotoUrl } from "@/lib/photo-url"

export const dynamic = "force-dynamic"
export const metadata = { title: "My Bids — Vectis" }

function displayLotNum(lotNumber: string, auctionCode: string): string {
  return lotNumber.replace(new RegExp(`^${auctionCode}`, "i"), "").replace(/^0+/, "") || lotNumber
}

export default async function MyBidsPage() {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  // Fetch all commission bids for this customer
  const bids = await prisma.commissionBid.findMany({
    where: { customerAccountId: session.id },
    orderBy: { placedAt: "desc" },
    include: {
      lot: {
        select: {
          id: true,
          lotNumber: true,
          title: true,
          estimateLow: true,
          estimateHigh: true,
          hammerPrice: true,
          imageUrls: true,
          status: true,
          condition: true,
          auction: {
            select: {
              id: true,
              code: true,
              name: true,
              auctionDate: true,
              finished: true,
              complete: true,
            },
          },
        },
      },
    },
  })

  // Check for any active live auction
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: true },
  })

  const hasBids = bids.length > 0

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">My Bids</h1>
      <p className="text-sm text-gray-500 mb-6">Your commission bids and bidding history.</p>

      {/* Live auction alert */}
      {liveAuction && (
        <div className="mb-6 bg-red-50 border border-red-300 p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
            <div>
              <p className="font-bold text-red-800 text-sm">Auction Live Now: {liveAuction.auction.name}</p>
              <p className="text-red-600 text-xs mt-0.5">Join the live bidding room to bid in real time</p>
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

      {hasBids ? (
        <div className="flex flex-col gap-0 border border-gray-200 bg-white mb-6">
          {bids.map(bid => {
            const lot = bid.lot
            const auction = lot.auction
            const img = lotPhotoUrl(lot.imageUrls[0], true)
            const lotNum = displayLotNum(lot.lotNumber, auction.code)
            const isFinished = auction.finished || auction.complete
            const sold = lot.status === "SOLD"
            const won = sold && lot.hammerPrice !== null

            return (
              <div key={bid.id} className="flex items-stretch border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors">
                {/* Thumbnail */}
                <Link
                  href={`/auctions/${auction.code}/lot/${lot.id}`}
                  className="relative shrink-0 bg-gray-100 overflow-hidden"
                  style={{ width: "80px", minHeight: "80px" }}
                >
                  {img ? (
                    <Image src={img} alt={lot.title} fill className="object-cover" sizes="80px" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </Link>

                {/* Details */}
                <div className="flex-1 px-4 py-3 flex flex-col justify-center min-w-0">
                  <Link href={`/auctions/${auction.code}/lot/${lot.id}`} className="hover:underline">
                    <p className="text-sm font-bold text-[#1e3058] truncate">{lot.title}</p>
                  </Link>
                  <p className="text-xs text-gray-400 mt-0.5">
                    <Link href={`/auctions/${auction.code}`} className="hover:text-[#1e3058]">{auction.name}</Link>
                    {" · "}Lot {lotNum}
                    {auction.auctionDate && (
                      <> · {format(new Date(auction.auctionDate), "d MMM yyyy")}</>
                    )}
                  </p>
                </div>

                {/* Bid amount */}
                <div className="shrink-0 px-4 py-3 flex flex-col items-end justify-center border-l border-gray-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Your Max Bid</p>
                  <p className="text-lg font-black text-[#1e3058]">£{bid.maxBid.toLocaleString("en-GB")}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {format(new Date(bid.placedAt), "d MMM yyyy HH:mm")}
                  </p>
                </div>

                {/* Status badge */}
                <div className="shrink-0 w-28 border-l border-gray-100 flex items-center justify-center px-3">
                  {won ? (
                    <span className="text-[10px] font-black uppercase tracking-widest text-green-700 bg-green-50 border border-green-300 px-2 py-1 text-center">
                      WON<br />
                      <span className="text-green-800">£{lot.hammerPrice!.toLocaleString("en-GB")}</span>
                    </span>
                  ) : sold ? (
                    <span className="text-[10px] font-black uppercase tracking-widest text-red-600 bg-red-50 border border-red-200 px-2 py-1 text-center">
                      SOLD
                    </span>
                  ) : isFinished ? (
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 border border-gray-200 px-2 py-1 text-center">
                      ENDED
                    </span>
                  ) : (
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#2AB4A6] bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 px-2 py-1 text-center">
                      ACTIVE
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 p-8 mb-6 text-center">
          <div className="w-16 h-16 bg-[#1e3058]/5 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#1e3058]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-gray-700 font-semibold text-lg mb-2">No bids placed yet</p>
          <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">
            Browse our upcoming auctions and place commission bids on the lots you want. Your bids will appear here.
          </p>
          <Link
            href="/auctions"
            className="inline-block bg-[#1e3058] hover:bg-[#162544] text-white text-xs font-black uppercase tracking-widest px-6 py-3 transition-colors"
          >
            Browse Auctions
          </Link>
        </div>
      )}

      {/* How bidding works note */}
      <div className="bg-gray-50 border border-gray-200 p-5 text-sm text-gray-600">
        <p className="font-bold text-gray-800 mb-2">How commission bids work</p>
        <p className="text-xs leading-relaxed text-gray-500">
          Your maximum bid is kept confidential. During the live auction, bids are placed on your behalf up to your maximum.
          A buyer&apos;s premium of <strong>22% + VAT</strong> applies to all winning bids.
          To update or cancel a bid before the sale date, please <Link href="/auctions" className="text-[#1e3058] underline">contact us</Link>.
        </p>
      </div>
    </div>
  )
}
