"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { placeCommissionBid } from "@/lib/actions/commission-bid"
import RegisterToBidModal from "../../../register-to-bid-modal"
import { getIncrement, getMinBid, nextBid, INCREMENT_TABLE } from "@/lib/bid-increments"

interface Props {
  lotId: string
  auctionId: string
  auctionCode: string
  auctionName: string
  isLoggedIn: boolean
  isRegistered: boolean
  existingMaxBid: number | null
  estimateLow: number | null
  isLive: boolean
}

export default function LotBidPanel({
  lotId,
  auctionId,
  auctionCode,
  auctionName,
  isLoggedIn,
  isRegistered,
  existingMaxBid,
  estimateLow,
  isLive,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showTable, setShowTable] = useState(false)

  const minBid = getMinBid(estimateLow)

  // Default = existing bid, or the minimum opening bid
  const defaultBid = existingMaxBid ?? minBid

  const [bidAmount, setBidAmount] = useState<number>(defaultBid)
  const [result, setResult] = useState<{ success?: boolean; updated?: boolean; error?: string } | null>(null)

  const currentIncrement = getIncrement(bidAmount)
  const belowMin = bidAmount < minBid

  function stepUp() {
    setBidAmount(prev => nextBid(prev))
    setResult(null)
  }

  function stepDown() {
    setBidAmount(prev => {
      const inc = getIncrement(prev - 1)
      return Math.max(minBid, prev - inc)
    })
    setResult(null)
  }

  function handleBidClick() {
    if (!isLoggedIn) {
      router.push(`/portal/login?redirect=/auctions/${auctionCode}/lot/${lotId}`)
      return
    }
    if (!isRegistered) {
      setShowRegisterModal(true)
      return
    }
    submitBid()
  }

  function submitBid() {
    setResult(null)
    startTransition(async () => {
      const res = await placeCommissionBid(lotId, bidAmount)
      if ("error" in res) {
        setResult({ error: res.error })
      } else {
        setResult({ success: true, updated: res.updated })
        router.refresh()
      }
    })
  }

  // Live auction — redirect to live room instead
  if (isLive) {
    return (
      <div className="bg-red-50 border border-red-300 p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <p className="text-sm font-black text-red-700 uppercase tracking-widest">Auction Live Now</p>
        </div>
        <p className="text-xs text-red-600 mb-3">This auction is currently running live. Join to bid in real time.</p>
        <a
          href={`/auctions/${auctionCode}/live`}
          className="inline-block bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-widest px-5 py-2.5 transition-colors"
        >
          Join Live Auction
        </a>
      </div>
    )
  }

  return (
    <>
      <div className="border border-[#32348A]/20 bg-white p-5 mb-6">
        <h3 className="text-xs font-black uppercase tracking-widest text-[#32348A] mb-4">
          {existingMaxBid ? "Update Your Commission Bid" : "Place a Commission Bid"}
        </h3>

        {existingMaxBid && (
          <div className="bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 px-3 py-2 mb-4">
            <p className="text-xs text-gray-600">
              Your current maximum bid:{" "}
              <span className="font-black text-[#32348A] text-sm">
                £{existingMaxBid.toLocaleString("en-GB")}
              </span>
            </p>
          </div>
        )}

        {/* Bid stepper */}
        <div className="mb-4">
          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
            Maximum Bid
          </label>

          <div className={`flex items-stretch border transition-colors ${belowMin ? "border-red-400 focus-within:border-red-500" : "border-gray-300 focus-within:border-[#32348A]"}`}>
            {/* Decrement */}
            <button
              type="button"
              onClick={stepDown}
              disabled={bidAmount <= minBid}
              className="px-4 py-3 text-lg font-black text-gray-500 hover:text-[#32348A] hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed border-r border-gray-300 transition-colors select-none"
            >
              −
            </button>

            {/* Amount display / manual input */}
            <div className="flex-1 flex items-center justify-center gap-1 px-4 py-3">
              <span className="text-gray-400 font-bold text-lg">£</span>
              <input
                type="number"
                min={minBid}
                step={currentIncrement}
                value={bidAmount}
                onChange={e => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 0) { setBidAmount(v); setResult(null) }
                }}
                className="w-28 text-center text-2xl font-black text-[#32348A] focus:outline-none bg-transparent"
              />
            </div>

            {/* Increment */}
            <button
              type="button"
              onClick={stepUp}
              className="px-4 py-3 text-lg font-black text-gray-500 hover:text-[#32348A] hover:bg-gray-50 border-l border-gray-300 transition-colors select-none"
            >
              +
            </button>
          </div>

          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[10px] text-gray-400">
              Min. bid: <span className="font-bold text-gray-600">£{minBid.toLocaleString("en-GB")}</span>
            </p>
            <p className="text-[10px] text-gray-400">
              Increment: <span className="font-bold text-gray-600">£{currentIncrement}</span>
            </p>
          </div>

          {belowMin && (
            <p className="text-[11px] text-red-600 font-semibold mt-1.5 bg-red-50 border border-red-200 px-3 py-1.5">
              Minimum bid for this lot is £{minBid.toLocaleString("en-GB")}
            </p>
          )}
        </div>

        {/* Result message */}
        {result?.error && (
          <div className="bg-red-50 border border-red-300 text-red-700 text-xs font-semibold px-3 py-2 mb-3">
            {result.error}
          </div>
        )}
        {result?.success && (
          <div className="bg-green-50 border border-green-300 text-green-700 text-xs font-semibold px-3 py-2 mb-3">
            {result.updated ? "✓ Your bid has been updated." : "✓ Bid placed successfully!"}
          </div>
        )}

        {/* Place bid button */}
        <button
          type="button"
          onClick={handleBidClick}
          disabled={isPending || belowMin}
          className="w-full bg-[#32348A] hover:bg-[#28296e] disabled:opacity-50 text-white font-black uppercase tracking-widest text-sm py-3 transition-colors mb-3"
        >
          {isPending
            ? "Placing Bid…"
            : !isLoggedIn
            ? "Log In to Bid"
            : !isRegistered
            ? "Register & Place Bid"
            : existingMaxBid
            ? `Update to £${bidAmount.toLocaleString("en-GB")}`
            : `Place Bid — £${bidAmount.toLocaleString("en-GB")}`}
        </button>

        {/* Increment table toggle */}
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          className="w-full text-[10px] text-gray-400 hover:text-[#32348A] transition-colors text-center py-1"
        >
          {showTable ? "▲ Hide" : "▼ Show"} bid increment table
        </button>

        {showTable && (
          <div className="mt-3 border border-gray-200 text-xs overflow-hidden">
            <div className="grid grid-cols-2 bg-gray-50 border-b border-gray-200 px-3 py-1.5">
              <span className="font-black uppercase tracking-widest text-gray-400 text-[10px]">Bid Range</span>
              <span className="font-black uppercase tracking-widest text-gray-400 text-[10px]">Increment</span>
            </div>
            {INCREMENT_TABLE.map((row, i) => {
              const active = bidAmount >= row.from && (row.to === null || bidAmount < row.to)
              return (
                <div key={i} className={`grid grid-cols-2 px-3 py-1.5 border-b border-gray-100 last:border-b-0 ${active ? "bg-[#32348A]/5 font-bold text-[#32348A]" : "text-gray-500"}`}>
                  <span>£{row.from.toLocaleString("en-GB")} {row.to ? `– £${row.to.toLocaleString("en-GB")}` : "+"}</span>
                  <span>£{row.inc.toLocaleString("en-GB")}</span>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[10px] text-gray-400 mt-3 leading-relaxed text-center">
          Commission bids are executed on your behalf up to your maximum.
          A buyer&apos;s premium of 22% + VAT applies to all winning lots.
        </p>
      </div>

      {showRegisterModal && (
        <RegisterToBidModal
          auctionId={auctionId}
          auctionName={auctionName}
          onClose={() => setShowRegisterModal(false)}
          onRegistered={() => {
            setShowRegisterModal(false)
            submitBid()
          }}
        />
      )}
    </>
  )
}
