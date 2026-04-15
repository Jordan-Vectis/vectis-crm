"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { placeCommissionBid } from "@/lib/actions/commission-bid"
import RegisterToBidModal from "../../../register-to-bid-modal"

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

const BID_INCREMENTS = [5, 10, 20, 50, 100, 200, 500]

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
  const [bidAmount, setBidAmount] = useState<string>(
    existingMaxBid ? String(existingMaxBid) : (estimateLow ? String(estimateLow) : "")
  )
  const [result, setResult] = useState<{ success?: boolean; updated?: boolean; error?: string } | null>(null)

  function handleIncrement(inc: number) {
    const current = parseInt(bidAmount || "0", 10)
    setBidAmount(String(current + inc))
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
    const amount = parseInt(bidAmount, 10)
    if (!amount || amount < 1) {
      setResult({ error: "Please enter a valid bid amount." })
      return
    }
    setResult(null)
    startTransition(async () => {
      const res = await placeCommissionBid(lotId, amount)
      if ("error" in res) {
        setResult({ error: res.error })
      } else {
        setResult({ success: true, updated: res.updated })
        router.refresh()
      }
    })
  }

  // If live, show a banner directing to the live page instead
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
      <div className="border border-[#1e3058]/20 bg-white p-5 mb-6">
        <h3 className="text-xs font-black uppercase tracking-widest text-[#1e3058] mb-4">
          {existingMaxBid ? "Update Your Commission Bid" : "Place a Commission Bid"}
        </h3>

        {existingMaxBid && (
          <div className="bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 px-3 py-2 mb-4">
            <p className="text-xs text-gray-600">
              Your current maximum bid:{" "}
              <span className="font-black text-[#1e3058] text-sm">
                £{existingMaxBid.toLocaleString("en-GB")}
              </span>
            </p>
          </div>
        )}

        {/* Amount input */}
        <div className="mb-3">
          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
            Maximum Bid (£)
          </label>
          <div className="flex items-stretch border border-gray-300 focus-within:border-[#1e3058] transition-colors">
            <span className="flex items-center px-3 text-gray-500 font-bold bg-gray-50 border-r border-gray-300 text-sm">
              £
            </span>
            <input
              type="number"
              min={1}
              value={bidAmount}
              onChange={e => { setBidAmount(e.target.value); setResult(null) }}
              placeholder="0"
              className="flex-1 px-3 py-2.5 text-lg font-black text-[#1e3058] focus:outline-none"
            />
          </div>
        </div>

        {/* Quick increment buttons */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {BID_INCREMENTS.map(inc => (
            <button
              key={inc}
              type="button"
              onClick={() => handleIncrement(inc)}
              className="px-3 py-1 text-xs font-bold border border-gray-300 text-gray-600 hover:border-[#1e3058] hover:text-[#1e3058] transition-colors"
            >
              +£{inc}
            </button>
          ))}
        </div>

        {/* Result message */}
        {result?.error && (
          <div className="bg-red-50 border border-red-300 text-red-700 text-xs font-semibold px-3 py-2 mb-3">
            {result.error}
          </div>
        )}
        {result?.success && (
          <div className="bg-green-50 border border-green-300 text-green-700 text-xs font-semibold px-3 py-2 mb-3">
            {result.updated ? "Your bid has been updated." : "Your bid has been placed successfully!"}
          </div>
        )}

        {/* Place bid button */}
        <button
          type="button"
          onClick={handleBidClick}
          disabled={isPending}
          className="w-full bg-[#1e3058] hover:bg-[#162544] disabled:opacity-50 text-white font-black uppercase tracking-widest text-sm py-3 transition-colors"
        >
          {isPending
            ? "Placing Bid…"
            : !isLoggedIn
            ? "Log In to Bid"
            : !isRegistered
            ? "Register & Bid"
            : existingMaxBid
            ? "Update My Bid"
            : "Place Bid"}
        </button>

        <p className="text-[10px] text-gray-400 mt-3 leading-relaxed text-center">
          Commission bids are executed on your behalf up to your maximum.
          Vectis charges a buyer&apos;s premium on the hammer price.
        </p>
      </div>

      {/* Register to bid modal (if logged in but not registered) */}
      {showRegisterModal && (
        <RegisterToBidModal
          auctionId={auctionId}
          auctionName={auctionName}
          onClose={() => setShowRegisterModal(false)}
          onRegistered={() => {
            setShowRegisterModal(false)
            // After registration, submit the bid
            submitBid()
          }}
        />
      )}
    </>
  )
}
