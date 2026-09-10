"use client"

import { useState } from "react"
import { Spinner } from "./feedback-shared"

// "⬇ Export to Excel (CSV)" — fetched, then handed to the browser as a file.
//
// ⚠ Not a plain <a href> to the export route, for two reasons found in review:
//  - A failed export (survey deleted by another admin, a database fault) answers with a JSON
//    { error } body. As a link, that NAVIGATES AWAY from the editor onto a page of raw JSON — and
//    any unsaved survey edits go with it.
//  - Browsers fire the "Leave site? Changes you made may not be saved" warning before they know a
//    link is a download, so with unsaved edits a perfectly good export looked like it was about to
//    throw the edits away.
// Fetched here, an error is shown in words beside the button, a slow export shows it is working,
// and the editor is never left. The blob download works on the iPads (iOS 13+).

function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) {
    try { return decodeURIComponent(star[1].trim()) } catch { /* fall through to the plain name */ }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition)
  return plain ? plain[1] : null
}

export default function ExportButton({ surveyId, label = "⬇ Export to Excel (CSV)", className }: {
  surveyId: string
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/admin/feedback/${encodeURIComponent(surveyId)}/export`, { cache: "no-store" })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null
        setError(
          data && typeof data.error === "string" && data.error
            ? `Couldn't export: ${data.error}`
            : `Couldn't export — the Hub's server answered with an error (${res.status}). Please try again.`,
        )
        return
      }
      const blob = await res.blob()
      const name = fileNameFrom(res.headers.get("Content-Disposition")) ?? "Hub feedback.csv"
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoked later, not at once: Safari can still be reading the blob when click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setDone(`✓ Exported “${name}” — it's in your downloads.`)
    } catch {
      setError("Couldn't reach the Hub's server — check the connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={className ?? "inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 px-4 font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-60 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"}
      >
        {busy ? <><Spinner /> Preparing the file…</> : label}
      </button>
      {error && <p role="alert" className="max-w-md text-sm text-red-600 dark:text-red-400">{error}</p>}
      {done && !error && <p role="status" className="max-w-md text-sm text-emerald-700 dark:text-emerald-400">{done}</p>}
    </div>
  )
}
