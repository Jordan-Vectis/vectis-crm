"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createSurvey } from "@/lib/actions/feedback"
import { Spinner } from "./feedback-shared"

// "＋ New survey": makes a DRAFT (dated title, the feature-request question, nobody ticked yet)
// and opens it. It stays showing "Creating…" until the survey's page replaces this one, so a
// slow connection never looks like a button that did nothing.
export default function NewSurveyButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await createSurvey()
      if (!res.ok || !res.id) {
        setError(res.error ?? "The survey wasn't created — please try again.")
        setBusy(false)
        return
      }
      router.push(`/admin/feedback/${res.id}`)
    } catch {
      setError("Couldn't reach the Hub's server — check the connection and try again.")
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={create}
        disabled={busy || disabled}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? <><Spinner /> Creating…</> : "＋ New survey"}
      </button>
      {error && <p role="alert" className="max-w-md text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
