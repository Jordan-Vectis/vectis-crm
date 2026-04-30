"use client"

import { useEffect, useRef } from "react"

export default function ResearchPage() {
  // ── Invisible research-time tracker ──────────────────────────────────────────
  // Tracks active (visible) milliseconds on this page and sends them to the
  // API on unmount or page close. Nothing is shown to the user.

  const accMs       = useRef(0)           // accumulated active ms
  const visibleAt   = useRef<number | null>(Date.now())
  const hasFlushed  = useRef(false)

  useEffect(() => {
    // Reset on mount
    accMs.current      = 0
    visibleAt.current  = Date.now()
    hasFlushed.current = false

    function getActiveMs() {
      const live = visibleAt.current ? Date.now() - visibleAt.current : 0
      return accMs.current + live
    }

    function flush() {
      if (hasFlushed.current) return
      const ms = getActiveMs()
      if (ms < 5_000) return                    // ignore blips under 5 seconds
      hasFlushed.current = true
      const payload = JSON.stringify({
        durationMs: ms,
        startedAt:  new Date(Date.now() - ms).toISOString(),
      })
      // sendBeacon is reliable during page unload; falls back to fetch otherwise
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/research/log",
          new Blob([payload], { type: "application/json" }),
        )
      }
    }

    function onVisibility() {
      if (document.hidden) {
        // Tab went background — accumulate and pause
        if (visibleAt.current !== null) {
          accMs.current += Date.now() - visibleAt.current
          visibleAt.current = null
        }
        // Save a checkpoint while in background (won't double-count — hasFlushed resets on resume)
        const ms = accMs.current
        if (ms >= 5_000) {
          const payload = JSON.stringify({
            durationMs: ms,
            startedAt:  new Date(Date.now() - ms).toISOString(),
          })
          navigator.sendBeacon(
            "/api/research/log",
            new Blob([payload], { type: "application/json" }),
          )
          // Reset so the next visible stretch starts fresh
          accMs.current = 0
          hasFlushed.current = false
        }
      } else {
        // Tab came back — restart the visible clock
        visibleAt.current  = Date.now()
        hasFlushed.current = false
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("beforeunload", flush)

    return () => {
      flush()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("beforeunload", flush)
    }
  }, [])

  // ── UI — full-height embedded search ─────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ height: "100%", overflow: "hidden" }}>
      <iframe
        src="https://www.bing.com"
        title="Research"
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
        allow="clipboard-read; clipboard-write; camera; microphone"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      />
    </div>
  )
}
