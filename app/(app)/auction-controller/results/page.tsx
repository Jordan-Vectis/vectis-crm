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

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString("en-GB")}`
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch { return iso }
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
      // Accumulate full bid list for each lot as it's active
      if (s.currentLot) {
        const { id, bids, title } = s.currentLot
        if (bids?.length) {
          setLotBids(prev => ({ ...prev, [id]: bids }))
        }
        if (title) {
          setLotTitles(prev => ({ ...prev, [id]: title }))
        }
      }
    })

    return () => { socket.disconnect() }
  }, [])

  const auction = state?.auction
  const lots = state?.lots ?? []
  const completedLots = lots.filter(l =>
    l.status === "SOLD" || l.status === "PASSED" || l.status === "WITHDRAWN"
  )
  const totalSold = completedLots.filter(l => l.status === "SOLD").length
  const totalValue = completedLots.reduce((sum, l) => sum + (l.hammerPrice ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col">

      {/* ── Header ── */}
      <div className="bg-[#161b2e] border-b border-white/10 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-white font-extrabold text-lg">📊 Live Results</h1>
          {auction && <p className="text-slate-400 text-sm mt-0.5">{auction.title}</p>}
        </div>
        <div className="flex items-center gap-8 text-sm">
          <div className="text-center">
            <p className="text-green-400 font-black text-2xl">{totalSold}</p>
            <p className="text-slate-500 text-xs uppercase tracking-wider">Sold</p>
          </div>
          <div className="text-center">
            <p className="text-red-400 font-black text-2xl">{completedLots.length - totalSold}</p>
            <p className="text-slate-500 text-xs uppercase tracking-wider">Unsold</p>
          </div>
          <div className="text-center">
            <p className="text-[#2AB4A6] font-black text-2xl">{fmt(totalValue)}</p>
            <p className="text-slate-500 text-xs uppercase tracking-wider">Total</p>
          </div>
          <div className="text-center">
            <p className="text-slate-300 font-black text-2xl">{state?.onlineCount ?? 0}</p>
            <p className="text-slate-500 text-xs uppercase tracking-wider">Online</p>
          </div>
        </div>
      </div>

      {/* ── Current live lot strip ── */}
      {state?.currentLot && (
        <div className="bg-blue-900/40 border-b border-blue-500/30 px-6 py-3 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span className="text-blue-300 font-bold text-sm">LOT {state.currentLot.lotNumber}</span>
          </div>
          <span className="text-white text-sm font-semibold truncate max-w-xs">{state.currentLot.title}</span>
          <span className="text-[#2AB4A6] font-black">{fmt(state.currentLot.currentBid)}</span>
          <span className="text-slate-400 text-xs">Asking: {fmt(state.currentLot.askingBid)}</span>
          <span className="text-slate-500 text-xs ml-auto">{state.currentLot.bids.length} bids so far</span>
        </div>
      )}

      {!auction && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500 text-lg">Waiting for auction to start…</p>
        </div>
      )}

      {/* ── Results — one section per lot ── */}
      {auction && (
        <div className="flex-1 overflow-auto">
          {completedLots.length === 0 ? (
            <p className="text-slate-600 text-center py-16">No completed lots yet</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="bg-[#0d1117] sticky top-[73px] z-10">
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-2 text-slate-500 font-bold uppercase tracking-wider text-[10px] w-20">Lot</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Bid Amount</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Customer No.</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Customer Name</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Bid Type</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Time</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...completedLots].reverse().map(lot => {
                  const bids = lotBids[lot.id] ?? []
                  const title = lotTitles[lot.id] ?? lot.title
                  const winnerBid = bids.length > 0 ? bids[bids.length - 1] : null
                  // All bids, most recent first
                  const allBids = [...bids].reverse()

                  return (
                    <>
                      {/* ── Lot header row ── */}
                      <tr key={`header-${lot.id}`} className="bg-[#161b2e] border-t-2 border-white/10">
                        <td className="px-4 py-3" colSpan={7}>
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className="text-[#2AB4A6] font-black text-sm">LOT {lot.lotNumber}</span>
                            <span className="text-white font-semibold text-sm truncate max-w-md">{title}</span>
                            <div className="ml-auto flex items-center gap-3">
                              {lot.status === "SOLD" ? (
                                <>
                                  <span className="bg-green-700 text-green-200 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
                                    SOLD
                                  </span>
                                  <span className="text-green-400 font-black text-lg">{fmt(lot.hammerPrice)}</span>
                                  {winnerBid && (
                                    <span className="text-slate-400 text-xs">
                                      🏆 Winner: <span className="text-white font-semibold">
                                        {winnerBid.bidderId ? `C${winnerBid.bidderId}` : "—"}{winnerBid.bidderName ? ` · ${winnerBid.bidderName}` : ""}
                                      </span>
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="bg-red-900/60 text-red-400 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
                                  {lot.status}
                                </span>
                              )}
                              <span className="text-slate-600 text-xs">{bids.length} bid{bids.length !== 1 ? "s" : ""}</span>
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* ── Individual bid rows ── */}
                      {allBids.length === 0 ? (
                        <tr key={`no-bids-${lot.id}`} className="border-b border-white/5">
                          <td colSpan={7} className="px-8 py-2 text-slate-600 text-xs italic">No bids recorded</td>
                        </tr>
                      ) : (
                        allBids.map((bid, bidIdx) => {
                          const isWinner = bidIdx === 0 && lot.status === "SOLD"
                          return (
                            <tr
                              key={`bid-${lot.id}-${bidIdx}`}
                              className={`border-b border-white/5 ${
                                isWinner
                                  ? "bg-green-900/25"
                                  : bidIdx % 2 === 0 ? "bg-[#0f1621]" : "bg-transparent"
                              } hover:bg-white/5`}
                            >
                              {/* Lot number — only on first bid row */}
                              <td className="px-4 py-2 text-slate-600 text-xs">
                                {bidIdx === 0 ? `LOT ${lot.lotNumber}` : ""}
                              </td>

                              {/* Bid amount */}
                              <td className="px-4 py-2">
                                <span className={`font-black text-base ${
                                  isWinner ? "text-green-400" : "text-white"
                                }`}>
                                  {fmt(bid.amount)}
                                </span>
                                {isWinner && (
                                  <span className="ml-2 text-green-500 text-[10px] font-bold uppercase tracking-wider">
                                    🏆 WINNER
                                  </span>
                                )}
                              </td>

                              {/* Customer number */}
                              <td className="px-4 py-2">
                                <span className={`font-mono text-sm ${isWinner ? "text-green-300 font-bold" : "text-slate-300"}`}>
                                  {bid.bidderId ? `C${bid.bidderId}` : "—"}
                                </span>
                              </td>

                              {/* Customer name */}
                              <td className="px-4 py-2">
                                <span className={`text-sm ${isWinner ? "text-green-200 font-semibold" : "text-slate-400"}`}>
                                  {bid.bidderName ?? "—"}
                                </span>
                              </td>

                              {/* Bid type */}
                              <td className="px-4 py-2">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                                  bid.type === "Online"    ? "bg-blue-900/60 text-blue-300" :
                                  bid.type === "Auto"      ? "bg-purple-900/60 text-purple-300" :
                                  bid.type === "Telephone" ? "bg-indigo-900/60 text-indigo-300" :
                                  bid.type === "Room"      ? "bg-slate-700 text-slate-300" :
                                                             "bg-slate-700 text-slate-400"
                                }`}>
                                  {bid.type}
                                </span>
                              </td>

                              {/* Time */}
                              <td className="px-4 py-2 text-slate-500 text-xs font-mono">
                                {fmtTime(bid.timestamp)}
                              </td>

                              {/* Status */}
                              <td className="px-4 py-2">
                                {isWinner ? (
                                  <span className="text-green-500 text-xs font-bold">Hammer</span>
                                ) : (
                                  <span className="text-slate-600 text-xs">Under-bid</span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </>
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
