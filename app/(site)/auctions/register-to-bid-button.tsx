"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import RegisterToBidModal from "./register-to-bid-modal"

interface Props {
  auctionId: string
  auctionName: string
  isLoggedIn: boolean
  alreadyRegistered: boolean
}

export default function RegisterToBidButton({ auctionId, auctionName, isLoggedIn, alreadyRegistered }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(alreadyRegistered)

  function handleClick() {
    if (!isLoggedIn) {
      router.push("/portal/login")
      return
    }
    setOpen(true)
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
        className="border border-gray-300 text-gray-500 hover:border-[#32348A] hover:text-[#32348A] text-xs font-bold uppercase tracking-widest px-4 py-2 transition-colors"
      >
        REGISTER TO BID
      </button>

      {open && (
        <RegisterToBidModal
          auctionId={auctionId}
          auctionName={auctionName}
          onClose={() => setOpen(false)}
          onRegistered={() => { setDone(true); setOpen(false) }}
        />
      )}
    </>
  )
}
