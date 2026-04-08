"use client"

import { useTransition } from "react"
import { sendFollowUp } from "@/lib/actions/submissions"

export default function SendFollowUpButton({ submissionId }: { submissionId: string }) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (!confirm("Mark a follow-up as sent to this customer?")) return
    startTransition(async () => {
      await sendFollowUp(submissionId)
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
    >
      {isPending ? "Sending..." : "Send Follow-up"}
    </button>
  )
}
