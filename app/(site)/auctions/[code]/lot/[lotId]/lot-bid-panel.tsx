"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { placeCommissionBid } from "@/lib/actions/commission-bid"
import RegisterToBidModal from "../../../register-to-bid-modal"
import { getIncrement, getMinBid, nextBid, roundUpToBid, isValidBid, INCREMENT_TABLE } from "@/lib/bid-increments"

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
  currentBid: number | null
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
  currentBid,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showTable, setShowTable] = useState(false)

  const minBid = getMinBid(estimateLow)
  const defaultBid = existingMaxBid ?? minBid

  const [bidAmount, setBidAmount] = useState<number>(defaultBid)
  const [result, setResult] = useState<{
    success?: boolean
    updated?: boolean
    outbid?: boolean
    currentLeadingBid?: number
    error?: string
    suggestedAmount?: number   // increment suggestion
  } | null>(null)

  const currentIncrement = getIncrement(bidAmount)
  const belowMin = bidAmount < minBid
  const invalidIncrement = !belowMin && !isValidBid(bidAmount)
  const suggestedAmount = invalidIncrement ? roundUpToBid(bidAmount) : null

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

  function handleManualInput(raw: string) {
    const v = parseInt(raw, 10)
    if (!isNaN(v) && v >= 0) {
      setBidAmount(v)
      setResult(null)
    }
  }

  function acceptSuggestion() {
    if (suggestedAmount) {
      setBidAmount(suggestedAmount)
      setResult(null)
    }
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
        // Check if the server caught an invalid increment — extract suggestion
        const match = res.error.match(/nearest valid amount is £([\d,]+)/)
        const suggested = match ? parseInt(match[1].replace(/,/g, ""), 10) : undefined
        setResult({ error: res.error, suggestedAmount: suggested })
      } else {
        setResult({
          success: true,
          updated: res.updated,
          outbid: res.outbid,
          currentLeadingBid: res.outbid ? res.currentLeadingBid : undefined,
        })
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

  const canSubmit = !isPending && !belowMin && !invalidIncrement

  return (
    <>
      <div className="border border-[#32348A]/20 bg-white p-5 mb-6">
        <h3 className="text-xs font-black uppercase tracking-widest text-[#32348A] mb-4">
          {existingMaxBid ? "Update Your Commission Bid" : "Place a Commission Bid"}
        </h3>

        {/* Existing bid reminder */}
        {existingMaxBid && (
          <p className="text-sm text-gray-600 mb-4">
            Your Maximum Bid:{" "}
            <span className="font-black text-[#32348A]">
              £{existingMaxBid.toLocaleString("en-GB")}
            </span>
          </p>
        )}

        {/* Bid stepper */}
        <div className="mb-4">
          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
            Maximum Bid
          </label>

          <div className={`flex items-stretch border transition-colors ${
            belowMin || invalidIncrement
              ? "border-red-400 focus-within:border-red-500"
              : "border-gray-300 focus-within:border-[#32348A]"
          }`}>
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
                value={bidAmount}
                onChange={e => handleManualInput(e.target.value)}
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

          {/* Below minimum warning */}
          {belowMin && (
            <p className="text-[11px] text-red-600 font-semibold mt-1.5 bg-red-50 border border-red-200 px-3 py-1.5">
              Minimum bid for this lot is £{minBid.toLocaleString("en-GB")}
            </p>
          )}

          {/* Invalid increment warning — offer to round up */}
          {invalidIncrement && suggestedAmount && (
            <div className="mt-1.5 bg-amber-50 border border-amber-300 px-3 py-2.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold text-amber-800">
                  £{bidAmount.toLocaleString("en-GB")} isn&apos;t a valid bid increment
                </p>
                <p className="text-[10px] text-amber-600 mt-0.5">
                  The next valid amount is £{suggestedAmount.toLocaleString("en-GB")}
                </p>
              </div>
              <button
                type="button"
                onClick={acceptSuggestion}
                className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-wider px-3 py-1.5 transition-colors whitespace-nowrap"
              >
                Use £{suggestedAmount.toLocaleString("en-GB")}
              </button>
            </div>
          )}
        </div>

        {/* Result messages */}
        {result?.error && (
          <div className="bg-red-50 border border-red-300 px-3 py-2.5 mb-3">
            <p className="text-xs font-bold text-red-700">{result.error}</p>
            {result.suggestedAmount && (
              <button
                type="button"
                onClick={() => { setBidAmount(result.suggestedAmount!); setResult(null) }}
                className="mt-2 text-[10px] font-black text-red-700 underline uppercase tracking-wider"
              >
                Use £{result.suggestedAmount.toLocaleString("en-GB")} instead
              </button>
            )}
          </div>
        )}

        {/* Outbid notification — inline red text matching existing site style */}
        {result?.success && result.outbid && (
          <div className="mb-3">
            <p className="text-sm font-bold text-[#DB0606] leading-snug">
              Another bidder has entered a higher maximum bid and you have been outbid!{" "}
              To have a chance of securing this lot, please increase your maximum bid.
            </p>
            <button
              type="button"
              onClick={() => {
                const newBid = nextBid(result.currentLeadingBid ?? bidAmount)
                setBidAmount(newBid)
                setResult(null)
              }}
              className="mt-2 text-xs font-bold text-[#32348A] underline hover:text-[#DB0606] transition-colors"
            >
              Set bid to £{nextBid(result.currentLeadingBid ?? bidAmount).toLocaleString("en-GB")} to take the lead →
            </button>
          </div>
        )}

        {/* Bid placed successfully (not outbid) */}
        {result?.success && !result.outbid && (
          <div className="bg-green-50 border border-green-300 text-green-700 text-xs font-semibold px-3 py-2 mb-3">
            {result.updated ? "✓ Your bid has been updated." : "✓ Bid placed successfully! You are currently leading."}
          </div>
        )}

        {/* Place bid button */}
        <button
          type="button"
          onClick={handleBidClick}
          disabled={!canSubmit}
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
