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
  bids?: BidEntry[]
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

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString("en-GB")}`
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }
  catch { return iso }
}

export default function ResultsPage() {
  const [state, setState] = useState<AuctionState | null>(null)
  const [lotBids, setLotBids] = useState<Record<string, BidEntry[]>>({})
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socketRef.current = socket

    socket.on("connect", () => {
      socket.emit("bidder:join", { name: "Results View" })
    })

    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      // Accumulate bids for each lot
      if (s.currentLot?.bids?.length) {
        setLotBids(prev => ({
          ...prev,
          [s.currentLot!.id]: s.currentLot!.bids,
        }))
      }
    })

    return () => { socket.disconnect() }
  }, [])

  const auction = state?.auction
  const lots = state?.lots ?? []
  const completedLots = lots.filter(l => l.status === "SOLD" || l.status === "PASSED" || l.status === "WITHDRAWN")
  const totalSold = completedLots.filter(l => l.status === "SOLD").length
  const totalValue = completedLots.reduce((sum, l) => sum + (l.hammerPrice ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col">

      {/* Header */}
      <div className="bg-[#161b2e] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-white font-extrabold text-lg">📊 Live Results</h1>
          {auction && <p className="text-slate-400 text-sm mt-0.5">{auction.title}</p>}
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <p className="text-green-400 font-black text-xl">{totalSold}</p>
            <p className="text-slate-500 text-xs">Sold</p>
          </div>
          <div className="text-center">
            <p className="text-red-400 font-black text-xl">{completedLots.length - totalSold}</p>
            <p className="text-slate-500 text-xs">Unsold</p>
          </div>
          <div className="text-center">
            <p className="text-[#2AB4A6] font-black text-xl">{fmt(totalValue)}</p>
            <p className="text-slate-500 text-xs">Total Value</p>
          </div>
          <div className="text-center">
            <p className="text-slate-300 font-black text-xl">{state?.onlineCount ?? 0}</p>
            <p className="text-slate-500 text-xs">Online</p>
          </div>
        </div>
      </div>

      {/* Current lot live strip */}
      {state?.currentLot && (
        <div className="bg-blue-900/40 border-b border-blue-500/30 px-6 py-3 flex items-center gap-6">
          <span className="text-blue-300 font-bold text-sm">🔴 LIVE: LOT {state.currentLot.lotNumber}</span>
          <span className="text-white text-sm font-semibold truncate max-w-xs">{state.currentLot.title}</span>
          <span className="text-[#2AB4A6] font-black">Current: {fmt(state.currentLot.currentBid)}</span>
          <span className="text-slate-400 text-sm">Asking: {fmt(state.currentLot.askingBid)}</span>
          <span className="text-slate-400 text-sm ml-auto">{state.currentLot.bids.length} bids</span>
        </div>
      )}

      {/* No auction */}
      {!auction && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500 text-lg">Waiting for auction to start…</p>
        </div>
      )}

      {/* Results table */}
      {auction && (
        <div className="flex-1 overflow-auto p-4">
          {completedLots.length === 0 ? (
            <p className="text-slate-600 text-center py-12">No results yet — sale in progress</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#161b2e] sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold uppercase tracking-wider text-xs">Lot</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold uppercase tracking-wider text-xs">Description</th>
                  <th className="text-center px-4 py-3 text-slate-400 font-bold uppercase tracking-wider text-xs">Result</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-bold uppercase tracking-wider text-xs">Hammer</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold uppercase tracking-wider text-xs">Winner</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold uppercase tracking-wider text-xs">Under-bidders</th>
                </tr>
              </thead>
              <tbody>
                {[...completedLots].reverse().map((lot, i) => {
                  const bids = lotBids[lot.id] ?? []
                  const winner = bids.length > 0 ? bids[bids.length - 1] : null
                  // Under-bidders: all unique bidders except the winner, sorted by bid desc
                  const underBidMap = new Map<string, BidEntry>()
                  for (const b of bids) {
                    const key = b.bidderId ?? b.bidderName ?? b.type
                    if (!underBidMap.has(key) || b.amount > underBidMap.get(key)!.amount) {
                      underBidMap.set(key, b)
                    }
                  }
                  const winnerKey = winner ? (winner.bidderId ?? winner.bidderName ?? winner.type) : null
                  const underBidders = [...underBidMap.values()]
                    .filter(b => (b.bidderId ?? b.bidderName ?? b.type) !== winnerKey)
                    .sort((a, b) => b.amount - a.amount)
                    .slice(0, 3)

                  return (
                    <tr key={lot.id} className={`border-b border-white/5 ${i % 2 === 0 ? "bg-[#0f1621]" : "bg-transparent"} hover:bg-white/5`}>
                      <td className="px-4 py-3">
                        <span className="text-[#2AB4A6] font-bold">LOT {lot.lotNumber}</span>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <span className="text-white text-xs line-clamp-2">{lot.title}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {lot.status === "SOLD" ? (
                          <span className="bg-green-900/60 text-green-400 text-xs font-bold px-2 py-0.5 rounded">SOLD</span>
                        ) : (
                          <span className="bg-red-900/40 text-red-400 text-xs font-bold px-2 py-0.5 rounded">{lot.status}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-black text-base ${lot.status === "SOLD" ? "text-green-400" : "text-slate-500"}`}>
                          {fmt(lot.hammerPrice)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {winner ? (
                          <div>
                            <p className="text-white text-xs font-semibold">{winner.bidderName ?? "—"}</p>
                            {winner.bidderId && <p className="text-slate-500 text-[10px]">ID: {winner.bidderId}</p>}
                            <p className="text-slate-600 text-[10px]">{winner.type} · {fmtTime(winner.timestamp)}</p>
                          </div>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {underBidders.length > 0 ? (
                          <div className="space-y-0.5">
                            {underBidders.map((b, j) => (
                              <div key={j} className="text-xs text-slate-400">
                                {b.bidderName ?? b.bidderId ?? b.type} — {fmt(b.amount)}
                              </div>
                            ))}
                          </div>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

    </div>
  )
}
