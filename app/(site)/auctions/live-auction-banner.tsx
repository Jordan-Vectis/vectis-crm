"use client"

import { useEffect, useState } from "react"
import { io as ioClient } from "socket.io-client"
import Image from "next/image"
import Link from "next/link"
import { lotPhotoUrl } from "@/lib/photo-url"

interface LotInfo {
  id: string
  lotNumber: string
  title: string
  imageUrls: string[]
  estimateLow: number | null
  estimateHigh: number | null
}

interface LiveLot {
  id: string
  lotNumber: string
  title: string
  description: string
  imageUrls: string[]
  estimateLow: number | null
  estimateHigh: number | null
  status: string
  currentBid: number
  askingBid: number
  hammerPrice: number | null
  bids: { amount: number; type: string; timestamp: string }[]
}

interface AuctionState {
  auction: {
    title: string; status: string; currentLotIndex: number
    fairWarning: boolean; totalLots: number
  } | null
  currentLot: LiveLot | null
  lots: { id: string; lotNumber: string; status: string; hammerPrice: number | null }[]
  onlineCount: number
}

interface Props {
  auctionId: string
  auctionName: string
  auctionCode: string
  currentLotIndex: number
  status: string
  lots: LotInfo[]
}

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString()}`
}

export default function LiveAuctionBanner({ auctionName, auctionCode, lots: initialLots }: Props) {
  const [state, setState] = useState<AuctionState | null>(null)
  const [fairWarning, setFairWarning] = useState(false)
  const [connected, setConnected] = useState(false)
  const [bidFlash, setBidFlash] = useState(false)

  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })

    socket.on("connect", () => {
      setConnected(true)
      socket.emit("bidder:join", { name: "Guest" })
    })
    socket.on("disconnect", () => setConnected(false))

    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      setFairWarning(s.auction?.fairWarning ?? false)
    })

    socket.on("bid:new", () => {
      setBidFlash(true)
      setTimeout(() => setBidFlash(false), 600)
    })

    socket.on("auction:fairWarning", () => {
      setFairWarning(true)
    })

    return () => { socket.disconnect() }
  }, [])

  const lot = state?.currentLot
  const auction = state?.auction

  // Fallback to initial lot at currentLotIndex if socket not yet connected
  const fallbackLot = initialLots[0] ?? null
  const rawImg = lot?.imageUrls?.[0] ?? fallbackLot?.imageUrls[0] ?? null
  const displayImg = lotPhotoUrl(rawImg, true)
  const displayTitle = lot?.title ?? fallbackLot?.title ?? "Loading..."
  const displayLotNum = lot?.lotNumber ?? fallbackLot?.lotNumber ?? "—"
  const totalLots = auction?.totalLots ?? initialLots.length
  const lotsSold = state?.lots.filter(l => l.status === "SOLD").length ?? 0

  return (
    <div className="bg-[#0d1117] border-b-4 border-red-500">
      {/* LIVE header bar */}
      <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
            <span className="font-extrabold text-sm tracking-widest uppercase">LIVE NOW</span>
          </span>
          <span className="text-red-200 text-sm font-medium">{auctionName}</span>
        </div>
        <div className="flex items-center gap-4 text-red-200 text-xs">
          <span>{lotsSold} of {totalLots} lots sold</span>
          <span>🌐 {state?.onlineCount ?? 0} watching</span>
          {!connected && <span className="text-red-300 animate-pulse">Connecting…</span>}
        </div>
      </div>

      {/* Main live panel */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">

        {/* Left — current lot */}
        <div className="flex gap-5">
          {/* Lot image */}
          <div className="relative w-44 h-44 shrink-0 rounded-xl overflow-hidden bg-[#1a2234]">
            {displayImg ? (
              <Image src={displayImg} alt={displayTitle} fill className="object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-slate-600 text-3xl font-black">{displayLotNum}</span>
              </div>
            )}
            {/* Fair warning overlay */}
            {fairWarning && (
              <div className="absolute inset-0 bg-amber-500/30 flex items-center justify-center animate-pulse">
                <span className="text-amber-300 font-extrabold text-lg">FAIR WARNING</span>
              </div>
            )}
          </div>

          {/* Lot info */}
          <div className="flex flex-col justify-between py-1">
            <div>
              <p className="text-slate-500 text-xs font-bold tracking-widest uppercase mb-1">
                Lot {displayLotNum} {auction ? `· ${auction.currentLotIndex + 1} of ${auction.totalLots}` : ""}
              </p>
              <h2 className="text-white font-extrabold text-xl leading-tight mb-1">{displayTitle}</h2>
              <p className="text-slate-400 text-sm">
                Guide: {fmt(lot?.estimateLow ?? fallbackLot?.estimateLow)} – {fmt(lot?.estimateHigh ?? fallbackLot?.estimateHigh)}
              </p>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-3 mt-3">
              {auction?.status === "ACTIVE" && !fairWarning && (
                <span className="bg-green-600/20 border border-green-500 text-green-400 text-xs font-bold px-3 py-1 rounded-full">
                  Bidding Open
                </span>
              )}
              {fairWarning && (
                <span className="bg-amber-600/20 border border-amber-500 text-amber-400 text-xs font-bold px-3 py-1 rounded-full animate-pulse">
                  ⚠️ Fair Warning
                </span>
              )}
              {auction?.status === "PAUSED" && (
                <span className="bg-slate-600/20 border border-slate-500 text-slate-400 text-xs font-bold px-3 py-1 rounded-full">
                  Paused
                </span>
              )}
            </div>

            <Link
              href={`/auctions/${auctionCode}`}
              className="mt-3 inline-block text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              View full catalogue →
            </Link>
          </div>
        </div>

        {/* Right — bid panel */}
        <div className="bg-[#1a2234] border border-white/10 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Current Bid</span>
            <span className="text-slate-500 text-xs">{lot?.bids?.length ?? 0} bids placed</span>
          </div>

          <div className={`text-4xl font-extrabold text-white transition-colors ${bidFlash ? "text-green-400" : ""}`}>
            {fmt(lot?.currentBid ?? 0)}
          </div>

          <div className="flex items-center justify-between bg-[#0d1117] rounded-lg px-4 py-3">
            <span className="text-slate-400 text-sm">Asking</span>
            <span className="text-white font-bold text-lg">{fmt(lot?.askingBid)}</span>
          </div>

          {/* Recent bids */}
          <div className="flex-1">
            <p className="text-slate-500 text-xs mb-2">Recent bids</p>
            <div className="flex flex-col gap-1">
              {(!lot?.bids || lot.bids.length === 0) ? (
                <p className="text-slate-600 text-xs text-center py-2">No bids yet</p>
              ) : (
                [...lot.bids].reverse().slice(0, 5).map((b, i) => (
                  <div key={i} className={`flex items-center justify-between text-xs rounded px-2 py-1.5 ${i === 0 ? "bg-blue-900/30 text-white" : "text-slate-400"}`}>
                    <span className="text-slate-500">{b.type}</span>
                    <span className={`font-bold ${i === 0 ? "text-white" : ""}`}>{fmt(b.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <Link
            href="/portal/register"
            className="w-full bg-[#1e3058] hover:bg-[#162544] border-2 border-white/20 hover:border-white/40 text-white font-bold text-sm text-center py-3 rounded-lg transition-colors"
          >
            Register to Bid Online
          </Link>
        </div>
      </div>
    </div>
  )
}
