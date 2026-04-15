import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import RegisterToBidButton from "../register-to-bid-button"

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase() },
  })
  return { title: auction ? `${auction.name} — Vectis Auctions` : "Auction — Vectis" }
}

export default async function AuctionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ search?: string; category?: string; page?: string }>
}) {
  const { code } = await params
  const { search, category, page } = await searchParams
  const currentPage = parseInt(page ?? "1", 10)
  const PAGE_SIZE = 48

  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase(), published: true },
    include: { lots: { orderBy: { lotNumber: "asc" } }, liveAuction: true },
  })

  const isLive = !!auction?.liveAuction && ["ACTIVE", "PAUSED"].includes(auction.liveAuction.status)

  if (!auction) notFound()

  // Dedupe categories
  const categories = [...new Set(auction.lots.map(l => l.category).filter(Boolean))] as string[]

  // Filter
  const filtered = auction.lots.filter(l => {
    if (category && l.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return l.title.toLowerCase().includes(q) || l.lotNumber.includes(q) || l.description.toLowerCase().includes(q)
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const lots = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const heroImg = lotPhotoUrl(auction.lots.find(l => l.imageUrls.length > 0)?.imageUrls[0], true)

  // Check customer session + registration status
  const customerSession = await getCustomerSession()
  const isLoggedIn = !!customerSession
  const alreadyRegistered = customerSession
    ? !!(await prisma.bidderRegistration.findUnique({
        where: {
          auctionId_customerAccountId: {
            auctionId: auction.id,
            customerAccountId: customerSession.id,
          },
        },
      }))
    : false

  return (
    <div>
      {/* ── Auction hero ── */}
      <div className="relative bg-[#1e3058] overflow-hidden" style={{ height: "280px" }}>
        {heroImg ? (
          <Image src={heroImg} alt={auction.name} fill className="object-cover opacity-30" priority />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#1e3058] to-[#2a4a7f]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
        <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 flex flex-col justify-end pb-8">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
            <Link href="/auctions" className="hover:text-white transition-colors uppercase tracking-wider font-semibold">Auction Calendar</Link>
            <span>/</span>
            <span className="text-white uppercase tracking-wider font-semibold">{auction.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-1">{auction.name}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300 mb-4">
            {auction.auctionDate && (
              <span>{format(new Date(auction.auctionDate), "EEEE do MMMM yyyy")}</span>
            )}
            <span className="text-[#2AB4A6] font-semibold">{TYPE_LABELS[auction.auctionType] ?? auction.auctionType}</span>
            <span>{auction.lots.length} lots</span>
            {auction.finished && <span className="text-amber-400 font-semibold">Auction Ended</span>}
          </div>
          <div className="flex flex-wrap gap-3">
            {isLive && (
              <Link
                href={`/auctions/${auction.code}/live`}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-black text-sm px-6 py-3 uppercase tracking-widest transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                BID LIVE NOW
              </Link>
            )}
            {!auction.finished && !auction.complete && (
              <RegisterToBidButton
                auctionId={auction.id}
                auctionName={auction.name}
                isLoggedIn={isLoggedIn}
                alreadyRegistered={alreadyRegistered}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <form method="GET" className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex items-center border border-gray-300 overflow-hidden">
              <span className="px-2 text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
              </span>
              <input
                name="search"
                defaultValue={search ?? ""}
                placeholder="Search lots…"
                className="py-2 pr-3 text-sm focus:outline-none w-52"
              />
            </div>

            {categories.length > 0 && (
              <select
                name="category"
                defaultValue={category ?? ""}
                className="border border-gray-300 px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">All Categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            <button
              type="submit"
              className="bg-[#1e3058] text-white text-sm font-semibold px-5 py-2 hover:bg-[#162544] transition-colors uppercase tracking-wider"
            >
              Filter
            </button>

            {(search || category) && (
              <Link href={`/auctions/${auction.code}`} className="text-sm text-gray-400 hover:text-[#1e3058] underline">
                Clear
              </Link>
            )}

            <span className="ml-auto text-sm text-gray-500">
              {filtered.length} lots {search || category ? "found" : "total"}
            </span>
          </form>
        </div>
      </div>

      {/* ── Lots grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {lots.length === 0 ? (
          <div className="text-center py-20 text-gray-400">No lots match your search.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-0 border-l border-t border-gray-200">
              {lots.map(lot => <LotCard key={lot.id} lot={lot} auctionCode={auction.code} />)}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-10">
                {currentPage > 1 && (
                  <PaginationLink code={auction.code} page={currentPage - 1} search={search} category={category} label="← Prev" />
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => Math.abs(p - currentPage) <= 2)
                  .map(p => (
                    <PaginationLink
                      key={p}
                      code={auction.code}
                      page={p}
                      search={search}
                      category={category}
                      label={String(p)}
                      active={p === currentPage}
                    />
                  ))}
                {currentPage < totalPages && (
                  <PaginationLink code={auction.code} page={currentPage + 1} search={search} category={category} label="Next →" />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Strip auction code prefix from lot number (e.g. "F051315" → "315")
function displayLotNum(lotNumber: string, auctionCode: string): string {
  return lotNumber.replace(new RegExp(`^${auctionCode}`, "i"), "").replace(/^0+/, "") || lotNumber
}

function LotCard({ lot, auctionCode }: {
  lot: {
    id: string; lotNumber: string; title: string
    estimateLow: number | null; estimateHigh: number | null
    hammerPrice: number | null; condition: string | null
    imageUrls: string[]; status: string
  }
  auctionCode: string
}) {
  const img = lotPhotoUrl(lot.imageUrls[0], true)
  const sold = lot.status === "SOLD"
  const lotNum = displayLotNum(lot.lotNumber, auctionCode)

  return (
    <div className="group border-r border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors flex flex-col cursor-pointer">
      {/* Image */}
      <div className="relative bg-gray-100 aspect-square overflow-hidden">
        {img ? (
          <Image
            src={img}
            alt={lot.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
           
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-200">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {/* Lot number badge */}
        <div className="absolute top-0 left-0 bg-[#1e3058] text-white text-[10px] font-bold px-2 py-0.5 tracking-wider">
          LOT {lotNum}
        </div>
        {sold && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white font-black text-sm tracking-widest uppercase">SOLD</span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-2.5 flex flex-col flex-1">
        <p className="text-xs font-medium text-gray-800 leading-snug line-clamp-2 mb-1.5 group-hover:text-[#1e3058]">
          {lot.title}
        </p>
        {lot.condition && (
          <p className="text-[10px] text-gray-400 mb-1">{lot.condition}</p>
        )}
        <div className="mt-auto">
          {sold && lot.hammerPrice ? (
            <div>
              <p className="text-[10px] text-gray-400">Sold</p>
              <p className="text-sm font-black text-[#1e3058]">£{lot.hammerPrice.toLocaleString("en-GB")}</p>
            </div>
          ) : (lot.estimateLow || lot.estimateHigh) ? (
            <div>
              <p className="text-[10px] text-gray-400">Estimate</p>
              <p className="text-xs font-bold text-gray-700">
                {lot.estimateLow && lot.estimateHigh
                  ? `£${lot.estimateLow.toLocaleString("en-GB")} – £${lot.estimateHigh.toLocaleString("en-GB")}`
                  : lot.estimateLow
                  ? `£${lot.estimateLow.toLocaleString("en-GB")}+`
                  : `–£${lot.estimateHigh!.toLocaleString("en-GB")}`}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-gray-300">Estimate TBC</p>
          )}
        </div>
      </div>
    </div>
  )
}

function PaginationLink({
  code, page, search, category, label, active,
}: {
  code: string; page: number; search?: string; category?: string; label: string; active?: boolean
}) {
  const params = new URLSearchParams()
  params.set("page", String(page))
  if (search) params.set("search", search)
  if (category) params.set("category", category)

  return (
    <Link
      href={`/auctions/${code}?${params.toString()}`}
      className={`min-w-[2.5rem] text-center px-3 py-2 text-sm font-semibold border transition-colors ${
        active
          ? "bg-[#1e3058] text-white border-[#1e3058]"
          : "bg-white text-[#1e3058] border-gray-300 hover:border-[#1e3058]"
      }`}
    >
      {label}
    </Link>
  )
}
