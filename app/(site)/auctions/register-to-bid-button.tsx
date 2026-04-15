"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { registerToBid } from "@/lib/actions/bidder-registration"

interface Props {
  auctionId: string
  auctionName: string
  isLoggedIn: boolean
  alreadyRegistered: boolean
}

export default function RegisterToBidButton({ auctionId, auctionName, isLoggedIn, alreadyRegistered }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tick1, setTick1] = useState(false)
  const [tick2, setTick2] = useState(false)
  const [done, setDone] = useState(alreadyRegistered)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    if (!isLoggedIn) {
      router.push("/portal/login")
      return
    }
    setOpen(true)
  }

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerToBid(auctionId)
      if ("error" in result) {
        if (result.error === "not_logged_in") {
          setOpen(false)
          router.push("/portal/login")
        } else {
          setError("Something went wrong. Please try again.")
        }
        return
      }
      setDone(true)
      setOpen(false)
    })
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-green-600 text-green-700 bg-green-50 text-xs font-black uppercase tracking-widest px-4 py-2">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        REGISTERED TO BID
      </span>
    )
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="border border-gray-300 text-gray-500 hover:border-[#1e3058] hover:text-[#1e3058] text-xs font-bold uppercase tracking-widest px-4 py-2 transition-colors"
      >
        REGISTER TO BID
      </button>

      {/* ── T&C Modal ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />

          {/* Panel */}
          <div className="relative bg-white w-full max-w-lg shadow-2xl z-10">
            {/* Header */}
            <div className="border-b border-gray-200 px-8 py-5">
              <h2 className="text-xl font-black text-[#1e3058] tracking-tight text-center">Terms and Conditions</h2>
            </div>

            {/* Body */}
            <div className="px-8 py-6 space-y-4 text-sm text-gray-700 leading-relaxed">
              <p>
                You are registering to bid in <strong>{auctionName}</strong>.
              </p>

              <p>
                Please note that submitting any bid is <strong>legally binding</strong>. You do have the option to reduce any maximum bid to the current bid level. If you would like to request a bid cancellation please contact us <strong>prior to the sale date</strong>.
              </p>

              <p>
                All successful bids require <strong>immediate payment</strong> following the auction. Failure to pay immediately could result in your account being suspended, a ban, or legal action being taken.
              </p>

              <p>
                All lots are sold as seen. Descriptions are provided in good faith but buyers are responsible for satisfying themselves as to condition prior to bidding. Returns are not accepted.
              </p>

              <p>
                A buyer&apos;s premium of <strong>22% + VAT</strong> is applicable to all lots unless otherwise stated.
              </p>

              <p className="text-[#1e3058] font-medium">
                Please note that by registering and submitting a bid you are agreeing to our{" "}
                <a href="/terms" target="_blank" className="underline hover:text-[#2AB4A6]">Terms &amp; Conditions</a>.
              </p>

              {/* Tick boxes */}
              <div className="space-y-3 pt-2 border-t border-gray-100">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={tick1}
                    onChange={e => setTick1(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#1e3058] shrink-0"
                  />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">
                    I accept all of the above Terms and Conditions
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={tick2}
                    onChange={e => setTick2(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#1e3058] shrink-0"
                  />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">
                    I understand that all bids are legally binding and payment is required immediately upon winning
                  </span>
                </label>
              </div>

              {error && (
                <p className="text-red-600 text-xs bg-red-50 border border-red-200 px-3 py-2">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 px-8 py-5 flex gap-3">
              <button
                onClick={() => { setOpen(false); setTick1(false); setTick2(false) }}
                className="flex-1 border border-gray-300 text-gray-600 hover:border-gray-400 text-xs font-bold uppercase tracking-widest py-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRegister}
                disabled={!tick1 || !tick2 || isPending}
                className="flex-1 bg-[#1e3058] hover:bg-[#162544] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest py-3 transition-colors"
              >
                {isPending ? "Registering…" : "Confirm Registration"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
