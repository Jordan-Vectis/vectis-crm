"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

type Job = { id: string; totalRows: number; offset: number; added: number; skipped: number; bad: number; done: boolean; error: string | null }

// Admin-only panel: upload the old system's lot export and load it in chunks.
// The file goes straight to R2 (it's far too big for a request body); the server
// parses it once and works through it 2,000 rows at a time while this loops.
export default function ArchiveImport() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

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

      setStage("Reading the spreadsheet…")
      const s = await fetch("/api/databases/archive/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: j.key, filename: file.name }) })
      let cur: Job = await s.json().catch(() => ({}))
      if (!s.ok) throw new Error((cur as any)?.error ?? "Couldn't read the spreadsheet")
      setJob(cur)

      setStage("Loading lots…")
      while (!cur.done) {
        const n = await fetch("/api/databases/archive/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: cur.id }) })
        const nj = await n.json().catch(() => ({}))
        if (!n.ok) throw new Error(nj?.error ?? "Import stopped part-way — press Import again with the same file to carry on; rows already loaded are skipped")
        cur = nj; setJob(cur)
      }
      setStage("Done")
      router.refresh()
    } catch (e: any) { setError(e?.message ?? "Import failed"); setStage(null) }
    setBusy(false)
  }

  const small = "min-h-[44px] px-4 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Import the old system's lot export</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">A spreadsheet with AuctionID, AuctionDate, OnlineTitle, Lot, Description, BottomPrice, TopPrice, HammerPrice. Lots already in the archive (same AuctionID and Lot) are skipped, so it is safe to run again with a newer export.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = "" }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className={`${small} bg-violet-600 hover:bg-violet-500 text-white font-semibold`}>{busy ? "Importing…" : "⬆ Import spreadsheet"}</button>
        </div>
      </div>
      {stage && (
        <div className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
          <div className="flex justify-between mb-1"><span>{stage}</span>
            <span className="font-mono">{job ? `${Math.min(job.offset, job.totalRows).toLocaleString()} of ${job.totalRows.toLocaleString()}` : stage.startsWith("Uploading") ? `${pct}%` : ""}</span></div>
          <div className="h-2 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${job ? Math.round((Math.min(job.offset, job.totalRows) / Math.max(1, job.totalRows)) * 100) : stage.startsWith("Uploading") ? pct : 5}%` }} />
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
