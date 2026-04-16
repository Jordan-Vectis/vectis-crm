"use client"

import { useEffect, useRef, useState } from "react"
import { io as ioClient, Socket } from "socket.io-client"
import Image from "next/image"
import Link from "next/link"
import { format } from "date-fns"

interface Lot {
  id: string
  lotNumber: string
  title: string
  description: string
  imageUrls: string[]       // already proxy-resolved
  estimateLow: number | null
  estimateHigh: number | null
  hammerPrice: number | null
  status: string
}

interface BidEntry {
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
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
  bids: BidEntry[]
}

interface AuctionState {
  auction: {
    title: string; status: string; currentLotIndex: number
    fairWarning: boolean; pauseMessage: string | null; totalLots: number
  } | null
  currentLot: LiveLot | null
  lots: { id: string; lotNumber: string; status: string; hammerPrice: number | null; currentBid: number }[]
  onlineCount: number
}

interface Props {
  auctionId: string
  auctionName: string
  auctionCode: string
  auctionDate: string | null
  initialLotIndex: number
  isLive: boolean
  lots: Lot[]
  isLoggedIn: boolean
  isRegistered: boolean
  customerId: string | null
  customerName: string | null
}

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString()}`
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }
  catch { return iso }
}

export default function LiveBiddingRoom({
  auctionName, auctionCode, auctionDate, initialLotIndex, lots: initialLots,
  isLoggedIn, isRegistered, customerId, customerName,
}: Props) {
  const [state, setState] = useState<AuctionState | null>(null)
  const [fairWarning, setFairWarning] = useState(false)
  const [bidFlash, setBidFlash] = useState(false)
  const [connected, setConnected] = useState(false)
  const [descOpen, setDescOpen] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [imageIndex, setImageIndex] = useState(0)
  const [streamActive, setStreamActive] = useState(false)
  const [bidPending, setBidPending] = useState(false)
  const [bidFeedback, setBidFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const socketRef = useRef<Socket | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)

  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socketRef.current = socket
    socket.on("connect", () => {
      setConnected(true)
      socket.emit("bidder:join", {
        name: customerName ?? "Guest",
        bidderId: customerId ?? undefined,
      })
    })
    socket.on("disconnect", () => setConnected(false))
    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      setFairWarning(s.auction?.fairWarning ?? false)
      setImageIndex(0) // reset image index on lot change
    })
    socket.on("bid:new", () => { setBidFlash(true); setTimeout(() => setBidFlash(false), 800) })
    socket.on("auction:fairWarning", () => setFairWarning(true))
    socket.on("bid:accepted", ({ amount }: { amount: number }) => {
      setBidPending(false)
      setBidFeedback({ ok: true, msg: `✓ Bid of £${amount.toLocaleString("en-GB")} placed — you are now leading!` })
      setTimeout(() => setBidFeedback(null), 4000)
    })
    socket.on("bid:rejected", ({ reason }: { reason: string }) => {
      setBidPending(false)
      setBidFeedback({ ok: false, msg: reason })
      setTimeout(() => setBidFeedback(null), 4000)
    })

    // ── WebRTC: stream becomes available ───────────────────────────────────
    async function startViewingStream(broadcasterId: string) {
      // Close any existing connection
      peerConnectionRef.current?.close()

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })
      peerConnectionRef.current = pc

      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0]
          setStreamActive(true)
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit("webrtc:ice", { targetId: broadcasterId, candidate: e.candidate })
      }

      try {
        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
        await pc.setLocalDescription(offer)
        socket.emit("webrtc:offer", { targetId: broadcasterId, offer })
      } catch (err) {
        console.warn("WebRTC offer error:", err)
      }
    }

    socket.on("webrtc:streamAvailable", ({ broadcasterId }: { broadcasterId: string }) => {
      startViewingStream(broadcasterId)
    })

    socket.on("webrtc:answer", async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      try {
        await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer))
      } catch (err) {
        console.warn("WebRTC answer error:", err)
      }
    })

    socket.on("webrtc:ice", async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try {
        await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {}
    })

    socket.on("webrtc:streamEnded", () => {
      peerConnectionRef.current?.close()
      peerConnectionRef.current = null
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      setStreamActive(false)
    })

    return () => {
      socket.disconnect()
      peerConnectionRef.current?.close()
    }
  }, [])

  // Auto-scroll lot strip to active lot
  useEffect(() => {
    if (!autoScroll || !stripRef.current) return
    const idx = state?.auction?.currentLotIndex ?? initialLotIndex
    const btn = stripRef.current.children[idx] as HTMLElement | undefined
    btn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }, [state?.auction?.currentLotIndex, autoScroll, initialLotIndex])

  const lot = state?.currentLot
  const auction = state?.auction
  const lotIndex = auction?.currentLotIndex ?? initialLotIndex

  // Merge live lot data with static lots for images/title if socket hasn't connected yet
  const staticLot = initialLots[lotIndex] ?? initialLots[0]
  const displayImages = lot?.imageUrls?.length ? lot.imageUrls : staticLot?.imageUrls ?? []
  const displayTitle = lot?.title ?? staticLot?.title ?? "—"
  const displayDesc = lot?.description ?? staticLot?.description ?? ""
  const displayLotNum = lot?.lotNumber ?? staticLot?.lotNumber ?? "—"
  const displayImg = displayImages[imageIndex] ?? null

  const currentBid = lot?.currentBid ?? 0
  const askingBid = lot?.askingBid ?? staticLot?.estimateLow ?? 0
  const estimateLow = lot?.estimateLow ?? staticLot?.estimateLow
  const estimateHigh = lot?.estimateHigh ?? staticLot?.estimateHigh

  const lastBid = lot?.bids?.[lot.bids.length - 1]
  const bids = lot?.bids ? [...lot.bids].reverse() : []

  // Is this customer currently the top bidder on the live lot?
  const isLeading = !!(customerId && lastBid?.bidderId === customerId)

  // Lots strip — use socket summary if available, otherwise initial lots
  const stripLots = state?.lots?.length
    ? state.lots
    : initialLots.map(l => ({ id: l.id, lotNumber: l.lotNumber, status: l.status, hammerPrice: l.hammerPrice, currentBid: 0 }))

  return (
    <div className="bg-white min-h-screen">

      {/* ── Page header ── */}
      <div className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-[#32348A] font-black text-xl">{auctionName}</h1>
          <Link href={`/auctions/${auctionCode}`} className="text-[#32348A] text-xs font-bold uppercase tracking-widest underline hover:no-underline">
            VIEW CATALOGUE
          </Link>
        </div>
        <div className="text-right">
          {connected ? (
            <span className="text-[#32348A] text-sm font-semibold">
              LIVE
              {auctionDate && (
                <span className="text-gray-500 font-normal ml-2">
                  {format(new Date(auctionDate), "d MMMM yyyy")} | {format(new Date(auctionDate), "HH:mm")}
                </span>
              )}
            </span>
          ) : (
            <span className="text-gray-400 text-sm animate-pulse">Connecting…</span>
          )}
        </div>
      </div>

      {/* ── Pause message overlay ── */}
      {state?.auction?.pauseMessage && (
        <div className="bg-[#32348A] border-b border-[#32348A]/50 px-6 py-10 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white font-black text-2xl uppercase tracking-wide mb-2">Sale Paused</p>
          <p className="text-white/80 text-base">{state.auction.pauseMessage}</p>
          <p className="text-white/40 text-xs mt-4">The auction will resume shortly — please do not leave this page</p>
        </div>
      )}

      {/* ── Main 3-column grid ── */}
      <div className="grid grid-cols-[380px_1fr_320px] gap-0 border-b border-gray-200" style={{ minHeight: "480px" }}>

        {/* COL 1 — lot image */}
        <div className="border-r border-gray-200 flex flex-col">
          <div className="relative bg-gray-100 flex-1" style={{ minHeight: "360px" }}>
            {displayImg ? (
              <Image
                src={displayImg}
                alt={displayTitle}
                fill
                className="object-contain p-4"
               
                priority
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {fairWarning && (
              <div className="absolute inset-0 border-4 border-amber-400 animate-pulse pointer-events-none" />
            )}
          </div>

          {/* Image thumbnails + zoom link */}
          <div className="p-3 border-t border-gray-100">
            {displayImages.length > 1 && (
              <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                {displayImages.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIndex(i)}
                    className={`relative w-12 h-12 shrink-0 border-2 rounded overflow-hidden transition-colors ${
                      i === imageIndex ? "border-[#32348A]" : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <Image src={img} alt="" fill className="object-cover" />
                  </button>
                ))}
              </div>
            )}
            <button className="flex items-center gap-1.5 text-[#32348A] text-xs font-semibold hover:underline">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              VIEW ZOOM/ADDITIONAL IMAGES
            </button>
          </div>

          {/* Lot number + description accordion */}
          <div className="border-t border-gray-200 px-4 py-3">
            <p className="text-[#32348A] text-xs font-black uppercase tracking-widest mb-1">LOT {displayLotNum}</p>
            <button
              onClick={() => setDescOpen(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-[#32348A] font-bold text-sm">Show Full Lot Description</span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${descOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            {descOpen && displayDesc && (
              <p className="text-gray-600 text-sm mt-2 leading-relaxed">{displayDesc}</p>
            )}
          </div>
        </div>

        {/* COL 2 — lot info + bidding */}
        <div className="p-6 border-r border-gray-200 flex flex-col">
          <p className="text-[#32348A] text-xs font-black uppercase tracking-widest mb-2">LOT {displayLotNum}</p>
          <h2 className="text-gray-800 font-semibold text-base leading-snug mb-6">{displayTitle}</h2>

          {/* Estimate */}
          <div className="flex items-center justify-between border-t border-gray-200 py-3">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-widest">ESTIMATE</span>
            <span className="text-gray-700 font-semibold text-sm">
              {fmt(estimateLow)} – {fmt(estimateHigh)}
            </span>
          </div>

          {/* Current bid */}
          <div className="flex items-center justify-between border-t border-gray-200 py-3">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-widest">CURRENT BID:</span>
            <div className="flex items-center gap-4">
              {lastBid && (
                <span className="text-gray-500 text-xs">{lastBid.bidderName ?? lastBid.type ?? "—"}</span>
              )}
              <span className={`font-black text-xl transition-colors ${bidFlash ? "text-green-600" : "text-[#32348A]"}`}>
                {fmt(currentBid)}
              </span>
            </div>
          </div>

          {/* Asking bid */}
          <div className="flex items-center justify-between border-t border-b border-gray-200 py-3 mb-6">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-widest">ASKING BID:</span>
            <span className="text-gray-700 font-bold text-base">{fmt(askingBid)}</span>
          </div>

          {/* Fair warning */}
          {fairWarning && (
            <div className="bg-amber-50 border-2 border-amber-400 text-amber-700 text-sm font-black text-center py-3 mb-4 tracking-widest animate-pulse">
              ⚠️ FAIR WARNING
            </div>
          )}

          {/* You are leading banner */}
          {isLeading && (
            <div className="bg-green-50 border-2 border-green-500 text-green-700 text-sm font-black text-center py-3 mb-4 tracking-wide">
              🏆 YOU ARE CURRENTLY WINNING THIS LOT
            </div>
          )}

          {/* Bid feedback */}
          {bidFeedback && (
            <div className={`text-sm font-semibold text-center py-2.5 px-3 mb-3 border ${
              bidFeedback.ok
                ? "bg-green-50 border-green-300 text-green-700"
                : "bg-red-50 border-red-300 text-red-700"
            }`}>
              {bidFeedback.msg}
            </div>
          )}

          {/* BID button — smart based on auth state */}
          {!isLoggedIn ? (
            // Not logged in → go to login
            <Link
              href={`/portal/login?redirect=/auctions/${auctionCode}/live`}
              className="block w-full bg-[#32348A] hover:bg-[#28296e] text-white font-black text-center py-4 text-sm tracking-widest uppercase transition-colors mb-3"
            >
              LOG IN TO BID
            </Link>
          ) : !isRegistered ? (
            // Logged in but not registered for this auction
            <div className="mb-3">
              <div className="w-full bg-gray-100 text-gray-400 font-black text-center py-4 text-sm tracking-widest uppercase mb-2 cursor-not-allowed">
                BID {fmt(askingBid)}
              </div>
              <p className="text-center text-xs text-gray-500">
                You need to{" "}
                <Link href={`/auctions/${auctionCode}`} className="text-[#32348A] underline font-semibold">
                  register to bid live
                </Link>{" "}
                for this auction
              </p>
            </div>
          ) : isLeading ? (
            // They are winning — don't let them bid against themselves
            <div
              onMouseEnter={() => socketRef.current?.emit("bidder:hoverBid", { hovering: true })}
              onMouseLeave={() => socketRef.current?.emit("bidder:hoverBid", { hovering: false })}
              className="w-full bg-green-600 text-white font-black text-center py-4 text-sm tracking-widest uppercase mb-3 cursor-default"
            >
              🏆 YOU ARE WINNING — {fmt(currentBid)}
            </div>
          ) : (
            // Logged in + registered + not currently leading → place live bid
            <button
              type="button"
              disabled={bidPending || !lot || lot.status !== "ACTIVE"}
              onMouseEnter={() => socketRef.current?.emit("bidder:hoverBid", { hovering: true })}
              onMouseLeave={() => socketRef.current?.emit("bidder:hoverBid", { hovering: false })}
              onClick={() => {
                if (!socketRef.current || !lot) return
                setBidPending(true)
                setBidFeedback(null)
                socketRef.current.emit("bid:place", {
                  amount: askingBid,
                  bidderId: customerId,
                  bidderName: customerName ?? "Online Bidder",
                })
              }}
              className="block w-full bg-[#32348A] hover:bg-[#28296e] disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-center py-4 text-sm tracking-widest uppercase transition-colors mb-3"
            >
              {bidPending ? "PLACING BID…" : `BID ${fmt(askingBid)}`}
            </button>
          )}

          {/* Approved to bid live — only shown when registered */}
          {isLoggedIn && isRegistered && (
            <div className="w-full border-2 border-[#32348A] text-[#32348A] font-bold text-center py-3 text-xs tracking-widest uppercase">
              ✓ APPROVED TO BID LIVE
            </div>
          )}

          {isLoggedIn && !isRegistered && (
            <Link
              href={`/auctions/${auctionCode}`}
              className="block w-full border-2 border-[#32348A] text-[#32348A] hover:bg-[#32348A] hover:text-white font-bold text-center py-3 text-xs tracking-widest uppercase transition-colors"
            >
              REGISTER TO BID LIVE
            </Link>
          )}

          <div className="mt-auto pt-6 text-center text-xs text-gray-400">
            {state?.onlineCount ?? 0} people watching live
          </div>
        </div>

        {/* COL 3 — video + bid history */}
        <div className="flex flex-col">
          {/* Video stream */}
          <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-cover ${streamActive ? "block" : "hidden"}`}
            />
            {!streamActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-white/20 border-2 border-white flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                  <p className="text-white/60 text-xs">Waiting for stream…</p>
                </div>
              </div>
            )}
            <div className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest">
              LIVE
            </div>
          </div>

          {/* Bid history table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-bold uppercase tracking-wider">LOT NO | TIME</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-bold uppercase tracking-wider">BID AMOUNT</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-bold uppercase tracking-wider">BID TYPE</th>
                </tr>
              </thead>
              <tbody>
                {bids.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-gray-400 py-6">No bids yet</td>
                  </tr>
                ) : (
                  bids.map((b, i) => (
                    <tr key={i} className={`border-b border-gray-100 ${i === 0 ? "bg-[#eef2f9]" : "hover:bg-gray-50"}`}>
                      <td className="px-3 py-2.5">
                        <span className="text-[#32348A] font-bold">LOT {displayLotNum}</span>
                        <span className="text-gray-400 ml-1">| {fmtTime(b.timestamp)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-gray-800">{fmt(b.amount)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{b.bidderName ?? b.type}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Lot strip ── */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 select-none">
            <div
              onClick={() => setAutoScroll(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoScroll ? "bg-[#32348A]" : "bg-gray-300"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoScroll ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            Disable Auto Scroll
          </label>
        </div>

        <div ref={stripRef} className="flex gap-2 overflow-x-auto pb-2">
          {stripLots.map((l, i) => {
            const staticL = initialLots.find(il => il.lotNumber === l.lotNumber)
            const thumb = staticL?.imageUrls[0] ?? null
            const isActive = i === lotIndex
            const isSold = l.status === "SOLD"
            const isPassed = l.status === "PASSED" || l.status === "WITHDRAWN"

            return (
              <div
                key={l.id}
                className={`shrink-0 w-44 border-2 rounded overflow-hidden cursor-pointer transition-colors ${
                  isActive ? "border-[#32348A]" :
                  isSold ? "border-green-400" :
                  isPassed ? "border-red-300" :
                  "border-gray-200 hover:border-gray-400"
                }`}
              >
                <div className="relative bg-gray-100" style={{ aspectRatio: "4/3" }}>
                  {thumb ? (
                    <Image src={thumb} alt="" fill className="object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-gray-100" />
                  )}
                  {isSold && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-white text-xs font-black">SOLD {fmt(l.hammerPrice)}</span>
                    </div>
                  )}
                  {isPassed && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <span className="text-white text-xs font-black">PASSED</span>
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 bg-white">
                  <p className="text-[#32348A] text-[10px] font-black uppercase">LOT {l.lotNumber}</p>
                  <p className="text-gray-600 text-[10px] leading-tight line-clamp-2">{staticL?.title ?? ""}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
