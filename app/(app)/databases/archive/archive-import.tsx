"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

type Job = { id: string; filename: string; totalRows: number; offset: number; added: number; skipped: number; bad: number; done: boolean; error: string | null; running: boolean }

// Admin-only panel: upload the old system's lot export and load it. The file goes
// straight to R2 (far too big for a request body); the server then streams it row
// by row in a loop of its own while this panel polls — closing the tab doesn't stop
// it, and a stopped or failed job can be resumed from where it got to.
export default function ArchiveImport() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const post = (body: unknown) => fetch("/api/databases/archive/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

  // Pick up a job that's already running (or stopped part-way) when the page opens.
  useEffect(() => { fetch("/api/databases/archive/import").then(r => r.ok ? r.json() : null).then(j => { if (j && !j.done) setJob(j) }).catch(() => {}) }, [])

  // Poll while the server loop is running.
  useEffect(() => {
    if (!job || !job.running) return
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/databases/archive/import?jobId=${job.id}`)
        if (!r.ok) return
        const j: Job = await r.json()
        setJob(j)
        if (j.done) { setStage("Done"); router.refresh() }
        else if (j.error) setError(j.error)
      } catch {}
    }, 1500)
    return () => clearInterval(t)
  }, [job?.id, job?.running, router])

  async function run(file: File) {
    setBusy(true); setError(null); setJob(null); setPct(0)
    try {
      setStage("Getting an upload link…")
      const r = await fetch("/api/databases/archive/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, size: file.size }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? "Couldn't get an upload link")

      setStage("Uploading the spreadsheet…")
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", j.url); xhr.setRequestHeader("Content-Type", j.contentType)
        xhr.upload.onprogress = e => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)) }
        xhr.onload = () => (xhr.status === 200 || xhr.status === 204) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`))
        xhr.onerror = () => reject(new Error("Upload failed — check the connection and try again"))
        xhr.send(file)
      })

      setStage("Loading lots…")
      const s = await post({ key: j.key, filename: file.name })
      const cur = await s.json().catch(() => ({}))
      if (!s.ok) throw new Error(cur?.error ?? "Couldn't start the import")
      setJob(cur)
    } catch (e: any) { setError(e?.message ?? "Import failed"); setStage(null) }
    setBusy(false)
  }

  async function resume() {
    if (!job) return
    setError(null)
    const r = await post({ jobId: job.id }); const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j?.error ?? "Couldn't resume"); return }
    setStage("Loading lots…"); setJob(j)
  }
  async function stop() { if (job) { await post({ jobId: job.id, action: "stop" }); setJob({ ...job, running: false }) } }

  const small = "min-h-[44px] px-4 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const showing = job && (job.running || !job.done)
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Import the old system's lot export</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">An .xlsx or .csv with AuctionID, AuctionDate, OnlineTitle, Lot, Description, BottomPrice, TopPrice, HammerPrice. Lots already in the archive (same AuctionID and Lot) are skipped, so it is safe to run again with a newer export. The load carries on by itself — you can leave the page.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = "" }} />
          {job?.running ? (
            <button onClick={stop} className={`${small} border border-gray-300 dark:border-gray-700 hover:border-violet-500`}>⏹ Stop</button>
          ) : job && !job.done ? (
            <button onClick={resume} className={`${small} bg-violet-600 hover:bg-violet-500 text-white font-semibold`}>▶ Resume import</button>
          ) : null}
          <button onClick={() => fileRef.current?.click()} disabled={busy || !!job?.running} className={`${small} bg-violet-600 hover:bg-violet-500 text-white font-semibold`}>{busy ? "Importing…" : "⬆ Import spreadsheet"}</button>
        </div>
      </div>
      {(stage || showing) && (
        <div className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
          <div className="flex justify-between mb-1">
            <span>{job?.done ? "Done" : job?.running ? `Loading lots from ${job.filename}…` : job ? `Stopped part-way through ${job.filename}` : stage}</span>
            <span className="font-mono">{job ? `${job.offset.toLocaleString()} rows read` : stage?.startsWith("Uploading") ? `${pct}%` : ""}</span>
          </div>
          <div className="h-2 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full bg-violet-500 transition-all ${job?.running ? "animate-pulse" : ""}`} style={{ width: `${job ? (job.done ? 100 : 60) : stage?.startsWith("Uploading") ? pct : 5}%` }} />
          </div>
          {job && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Added {job.added.toLocaleString()} · already there {job.skipped.toLocaleString()} · unreadable rows {job.bad.toLocaleString()}{job.done ? " · finished" : ""}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-700 dark:text-red-300">⚠ {error}</p>}
    </div>
  )
}
