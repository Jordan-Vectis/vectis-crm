import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import LiveAuctionBanner from "./live-auction-banner"
import { lotPhotoUrl } from "@/lib/photo-url"

export const metadata = { title: "Auction Calendar — Vectis" }
export const dynamic = "force-dynamic"

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

export default async function AuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; filter?: string }>
}) {
  const { search, filter } = await searchParams

  // Check for active live auction
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: { include: { lots: { orderBy: { lotNumber: "asc" } } } } },
  })

  const allPublished = await prisma.catalogueAuction.findMany({
    where: { published: true },
    orderBy: { auctionDate: "asc" },
    include: {
      _count: { select: { lots: true } },
      lots: { take: 1, where: { imageUrls: { isEmpty: false } }, select: { imageUrls: true } },
    },
  })

  // Apply search filter
  const auctions = allPublished.filter(a => {
    if (search) {
      const q = search.toLowerCase()
      return a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
    }
    if (filter === "Past") return a.finished || a.complete
    if (filter === "All") return true
    return !a.finished && !a.complete // default: upcoming
  })

  const upcoming = auctions.filter(a => !a.finished && !a.complete)
  const past     = auctions.filter(a => a.finished || a.complete)

  // Featured = first upcoming with a date
  const featured = upcoming.find(a => a.auctionDate) ?? upcoming[0] ?? null

  return (
    <div>
      {/* ── Live Auction Takeover ── */}
      {liveAuction && (
        <LiveAuctionBanner
          auctionId={liveAuction.auction.id}
          auctionName={liveAuction.auction.name}
          auctionCode={liveAuction.auction.code}
          currentLotIndex={liveAuction.currentLotIndex}
          status={liveAuction.status}
          lots={liveAuction.auction.lots.map(l => ({
            id: l.id,
            lotNumber: l.lotNumber,
            title: l.title,
            imageUrls: l.imageUrls,
            estimateLow: l.estimateLow,
            estimateHigh: l.estimateHigh,
          }))}
        />
      )}

      {/* ── Announcement bar ── */}
      {!liveAuction && (
        <div className="bg-[#e8edf5] border-b border-blue-200 text-center text-xs text-[#1e3058] font-medium py-2 px-4 tracking-wide">
          Register now to bid in our upcoming specialist auctions — online &amp; telephone bidding available
        </div>
      )}

      {/* ── Hero banner ── */}
      {featured && !liveAuction && (
        <div className="relative bg-[#1e3058] overflow-hidden" style={{ height: "480px" }}>
          {/* Background image */}
          {featured.lots[0]?.imageUrls[0] ? (
            <Image
              src={featured.lots[0].imageUrls[0]}
              alt={featured.name}
              fill
              className="object-cover opacity-40"
              priority
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#1e3058] via-[#2a4a7f] to-[#1e3058]" />
          )}

          {/* Overlay gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent" />

          {/* Content */}
          <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 flex flex-col justify-end pb-10">
            <div className="max-w-lg">
              <span className="inline-block text-xs font-bold tracking-[0.2em] text-[#2AB4A6] uppercase mb-3 bg-black/30 px-3 py-1 rounded">
                FEATURED
              </span>
              <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight mb-2">
                {featured.name}
              </h1>
              {featured.auctionDate && (
                <p className="text-gray-300 text-lg mb-1">
                  {format(new Date(featured.auctionDate), "EEEE do MMMM yyyy")}
                </p>
              )}
              {featured.eventName && (
                <p className="text-gray-400 text-sm mb-4">{featured.eventName}</p>
              )}
              <p className="text-gray-400 text-sm mb-6">
                {featured._count.lots} lots · {TYPE_LABELS[featured.auctionType] ?? featured.auctionType}
              </p>
              <Link
                href={`/auctions/${featured.code}`}
                className="inline-block bg-[#1e3058] hover:bg-[#162544] border-2 border-white text-white font-bold text-sm tracking-widest px-8 py-3 uppercase transition-colors"
              >
                VIEW LOTS
              </Link>
            </div>
          </div>

          {/* Dot pagination placeholder */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {upcoming.slice(0, Math.min(upcoming.length, 6)).map((a, i) => (
              <div
                key={a.id}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${i === 0 ? "bg-white" : "bg-white/40"}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">

        {/* Section heading */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black text-[#1e3058] uppercase tracking-tight">
            {search ? `Results for "${search}"` : filter === "Past" ? "Past Auctions" : "Upcoming Auctions"}
          </h2>
          <div className="flex gap-2">
            {[["Upcoming", ""], ["Past", "Past"], ["All", "All"]].map(([label, val]) => (
              <Link
                key={label}
                href={val ? `/auctions?filter=${val}` : "/auctions"}
                className={`text-xs font-semibold px-4 py-2 border transition-colors ${
                  (filter ?? "") === val
                    ? "bg-[#1e3058] text-white border-[#1e3058]"
                    : "bg-white text-[#1e3058] border-[#1e3058] hover:bg-[#1e3058] hover:text-white"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Upcoming auctions */}
        {upcoming.length === 0 && past.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-xl font-medium text-gray-500">No auctions found</p>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-0 border-l border-t border-gray-200 mb-12">
                {upcoming.map(auction => (
                  <AuctionCard key={auction.id} auction={auction} />
                ))}
              </div>
            )}

            {past.length > 0 && (
              <>
                <h2 className="text-xl font-black text-[#1e3058] uppercase tracking-tight mb-6 mt-10">
                  Past Auctions
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-0 border-l border-t border-gray-200">
                  {past.map(auction => (
                    <AuctionCard key={auction.id} auction={auction} past />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AuctionCard({
  auction,
  past = false,
}: {
  auction: {
    id: string; code: string; name: string; auctionDate: Date | null
    auctionType: string; eventName: string | null; finished: boolean; complete: boolean
    _count: { lots: number }
    lots: { imageUrls: string[] }[]
  }
  past?: boolean
}) {
  const img = auction.lots[0]?.imageUrls[0] ?? null
  const label = TYPE_LABELS[auction.auctionType] ?? auction.auctionType

  return (
    <Link
      href={`/auctions/${auction.code}`}
      className="group border-r border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors flex flex-col"
    >
      {/* Image */}
      <div className="relative bg-gray-100 aspect-[4/3] overflow-hidden">
        {img ? (
          <Image
            src={img}
            alt={auction.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e3058]/5">
            <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {past && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="text-white text-xs font-bold tracking-widest uppercase bg-black/50 px-3 py-1">Ended</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col flex-1">
        <p className="text-[10px] font-bold tracking-[0.15em] text-[#2AB4A6] uppercase mb-1">{label}</p>
        <h3 className="font-bold text-[#1e3058] text-sm leading-snug mb-1 group-hover:underline">
          {auction.name}
        </h3>
        {auction.auctionDate && (
          <p className="text-xs text-gray-500 mb-3">
            {format(new Date(auction.auctionDate), "EEEE do MMMM yyyy")}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between">
          <span className="text-xs text-gray-400">{auction._count.lots} lots</span>
          <span className="text-xs font-bold text-[#1e3058] uppercase tracking-wider group-hover:underline">
            View Lots →
          </span>
        </div>
      </div>
    </Link>
  )
}
