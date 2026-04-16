"use client"

import { useEffect, useRef, useState } from "react"
import { io as ioClient, Socket } from "socket.io-client"

interface BidEntry {
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
}

interface LotResult {
  id: string
  lotNumber: string
  title: string
  status: string
  currentBid: number
  hammerPrice: number | null
}

interface AuctionState {
  auction: {
    title: string
    code: string
    status: string
    currentLotIndex: number
    totalLots: number
  } | null
  currentLot: {
    id: string
    lotNumber: string
    title: string
    currentBid: number
    askingBid: number
    bids: BidEntry[]
  } | null
  lots: LotResult[]
  onlineCount: number
}

interface FlatBid {
  lotNumber: string
  lotId: string
  lotStatus: string
  hammerPrice: number | null
  isWinner: boolean
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
}

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString("en-GB")}`
}

function fmtDatetime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch { return iso }
}

function bidTypeLabel(type: string) {
  switch (type) {
    case "Online":    return "Online"
    case "Auto":      return "Vectis Auto"
    case "Telephone": return "Telephone"
    case "Room":      return "Saleroom"
    default:          return type ?? "—"
  }
}

export default function ResultsPage() {
  const [state, setState] = useState<AuctionState | null>(null)
  const [lotBids, setLotBids] = useState<Record<string, BidEntry[]>>({})
  const [lotTitles, setLotTitles] = useState<Record<string, string>>({})
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socketRef.current = socket

    socket.on("connect", () => {
      socket.emit("bidder:join", { name: "Results View" })
    })

    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      if (s.currentLot) {
        const { id, bids, title } = s.currentLot
        if (bids?.length) setLotBids(prev => ({ ...prev, [id]: bids }))
        if (title)       setLotTitles(prev => ({ ...prev, [id]: title }))
      }
    })

    return () => { socket.disconnect() }
  }, [])

  const auction = state?.auction
  const lots = state?.lots ?? []
  const completedLots = lots.filter(l =>
    l.status === "SOLD" || l.status === "PASSED" || l.status === "WITHDRAWN"
  )
  const totalSold  = completedLots.filter(l => l.status === "SOLD").length
  const totalValue = completedLots.reduce((sum, l) => sum + (l.hammerPrice ?? 0), 0)

  // Build flat bid list — all completed lots, all bids, newest first
  const flatBids: FlatBid[] = []
  for (const lot of [...completedLots].reverse()) {
    const bids = lotBids[lot.id] ?? []
    bids.forEach((bid, idx) => {
      flatBids.push({
        lotNumber:  lot.lotNumber,
        lotId:      lot.id,
        lotStatus:  lot.status,
        hammerPrice: lot.hammerPrice,
        isWinner:   idx === bids.length - 1 && lot.status === "SOLD",
        amount:     bid.amount,
        type:       bid.type,
        bidderId:   bid.bidderId,
        bidderName: bid.bidderName,
        timestamp:  bid.timestamp,
      })
    })
  }
  // Sort newest bid first
  flatBids.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div>
          <h1 className="text-gray-900 font-black text-xl">Live Results</h1>
          {auction && <p className="text-gray-400 text-sm mt-0.5">{auction.title}</p>}
        </div>
        <div className="flex items-center gap-10">
          <div className="text-center">
            <p className="text-green-500 font-black text-3xl leading-none">{totalSold}</p>
            <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Sold</p>
          </div>
          <div className="text-center">
            <p className="text-red-500 font-black text-3xl leading-none">{completedLots.length - totalSold}</p>
            <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Unsold</p>
          </div>
          <div className="text-center">
            <p className="text-[#32348A] font-black text-3xl leading-none">{fmt(totalValue)}</p>
            <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Total</p>
          </div>
          <div className="text-center">
            <p className="text-gray-700 font-black text-3xl leading-none">{state?.onlineCount ?? 0}</p>
            <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Online</p>
          </div>
        </div>
      </div>

      {/* ── Live lot strip ── */}
      {state?.currentLot && (
        <div className="bg-[#1a2744] px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span className="text-blue-300 font-bold text-sm">LOT {state.currentLot.lotNumber}</span>
          </div>
          <span className="text-white text-sm font-semibold truncate max-w-sm">{state.currentLot.title}</span>
          <span className="text-[#2AB4A6] font-black">{fmt(state.currentLot.currentBid)}</span>
          <span className="text-gray-400 text-xs">Asking: {fmt(state.currentLot.askingBid)}</span>
          <span className="text-gray-500 text-xs ml-auto">{state.currentLot.bids.length} bids so far</span>
        </div>
      )}

      {!auction && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400 text-lg">Waiting for auction to start…</p>
        </div>
      )}

      {/* ── Bid table ── */}
      {auction && (
        <div className="flex-1 overflow-auto">
          {flatBids.length === 0 ? (
            <p className="text-gray-400 text-center py-20">No bids recorded yet</p>
          ) : (
            <table className="w-full text-sm border-collapse bg-white">
              <thead className="sticky top-[73px] z-10 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest w-20"></th>
                  <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Customer No.</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Customer Name</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Bid Type</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Bid Amount</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Status</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Time</th>
                </tr>
              </thead>
              <tbody>
                {flatBids.map((bid, i) => (
                  <tr
                    key={`${bid.lotId}-${i}`}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    {/* Lot badge */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#32348A] text-white font-black text-sm">
                        {bid.lotNumber}
                      </span>
                    </td>

                    {/* Customer number */}
                    <td className="px-4 py-3">
                      <span className="text-[#32348A] font-semibold text-sm">
                        {bid.bidderId ? `C${bid.bidderId}` : "0"}
                      </span>
                    </td>

                    {/* Customer name */}
                    <td className="px-4 py-3 text-gray-700 font-medium">
                      {bid.bidderName || (bid.type === "Room" ? "Clerk" : "—")}
                    </td>

                    {/* Bid type */}
                    <td className="px-4 py-3 text-gray-500">
                      {bidTypeLabel(bid.type)}
                    </td>

                    {/* Bid amount */}
                    <td className="px-4 py-3">
                      <span className="text-gray-900 font-bold">{fmt(bid.amount)}</span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {bid.isWinner ? (
                        <span className="text-green-600 font-semibold text-xs">
                          Sold {fmtDatetime(bid.timestamp)}
                        </span>
                      ) : bid.lotStatus === "PASSED" || bid.lotStatus === "WITHDRAWN" ? (
                        <span className="text-red-400 text-xs font-semibold">{bid.lotStatus}</span>
                      ) : null}
                    </td>

                    {/* Time */}
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {fmtDatetime(bid.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
