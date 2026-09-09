"use client"

import { useState } from "react"
import { bcCollectorScript, COLLECTOR_FILE_MB } from "@/lib/bc-web-collector"

// Databases → BC Database → "Collect from the website (in your browser)".
//
// ⚠⚠ WHY THIS PANEL EXISTS. The website answers the Hub's server with 202 and an empty body for
// every sale, while the same request from a desk in the office returns the lots. Business Central
// holds the full description and the photo path but publishes neither, and there is no development
// time to change that. So the collecting is done in the browser ON vectis.co.uk — the site talking
// to itself — and the files it saves are loaded here.
//
// ⚠ Files are sent ONE AT A TIME, with a count that moves (RULES §7b). A single 60 MB post shows
// nothing while it runs and would be cut off by Railway's 20 MB body limit anyway.
export default function BcCollect({ defaultFrom, defaultTo, basis }: { defaultFrom: number; defaultTo: number; basis: string }) {
  const [from, setFrom] = useState(String(defaultFrom))
  const [to, setTo] = useState(String(defaultTo))
  const [copied, setCopied] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  const [lots, setLots] = useState(0)
  const [sales, setSales] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const f = Math.max(1, parseInt(from) || 0), t = Math.max(1, parseInt(to) || 0)
  const script = bcCollectorScript({ from: f, to: t })

  async function copy() {
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 4000)
    } catch {
      setError("This browser would not let the page copy for you — open “Show the script” below and copy it by hand.")
    }
  }

  async function load() {
    if (!files.length || busy) return
    setBusy(true); setError(null); setDone(null); setProblems([]); setAt(0); setLots(0); setSales(0)
    let totalLots = 0, totalSales = 0
    const found: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        setAt(i + 1)
        const fd = new FormData()
        fd.append("file", files[i])
        const res = await fetch("/api/databases/bc/collect", { method: "POST", body: fd })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j?.error ?? `${files[i].name} could not be loaded (${res.status})`)
        totalLots += j.lots ?? 0; totalSales += j.sales ?? 0
        setLots(totalLots); setSales(totalSales)
        if (Array.isArray(j.problems)) found.push(...j.problems)
      }
      setProblems(found)
      setDone(totalLots === 0
        ? "Nothing was loaded — the files held no Business Central lots. Check the collector ran on vectis.co.uk and reached the recent sales."
        : `Loaded ${totalLots.toLocaleString()} lot${totalLots === 1 ? "" : "s"} across ${totalSales.toLocaleString()} sale${totalSales === 1 ? "" : "s"}. Refresh the page to see them, then press Copy photos above to bring their pictures in.`)
    } catch (e: any) {
      setError(e?.message ?? "Could not load the files")
    } finally {
      setBusy(false)
    }
  }

  const box = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white focus:outline-none focus:border-violet-500"
  const btn = "min-h-[44px] inline-flex items-center px-4 rounded-lg font-semibold disabled:opacity-50"

  return (
    <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-5">
      <summary className="cursor-pointer text-base font-bold text-gray-900 dark:text-white">Collect from the website (in your browser)</summary>

      <div className="mt-3 space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <p>
          The website will not answer the Hub&rsquo;s server — every sale comes back empty — but it answers a browser
          on the office network normally. So this collects the lots <span className="font-semibold text-gray-900 dark:text-white">from your own browser</span>,
          saves them to your Downloads, and you load the files back here. Nothing else changes: the files go in through
          the same route the automatic pull uses.
        </p>

        {/* ─── Step 1 ─────────────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <div className="font-semibold text-gray-900 dark:text-white">1. Copy the script</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">First sale</span>
              <input value={from} onChange={e => setFrom(e.target.value)} inputMode="numeric" className={`${box} w-28`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Last sale</span>
              <input value={to} onChange={e => setTo(e.target.value)} inputMode="numeric" className={`${box} w-28`} />
            </label>
            <button type="button" onClick={copy} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>
              {copied ? "✓ Copied" : "📋 Copy script"}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            These are the website&rsquo;s own sale numbers, not our sale codes. {basis} Sales with no Business Central
            lots are skipped in one go, so a wide range mostly costs time.
          </p>
        </div>

        {/* ─── Step 2 ─────────────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-2">
          <div className="font-semibold text-gray-900 dark:text-white">2. Run it on the website</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open <a href="https://www.vectis.co.uk" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">www.vectis.co.uk ↗</a> in another tab.</li>
            <li>Press <span className="font-semibold text-gray-900 dark:text-white">F12</span>, then click the <span className="font-semibold text-gray-900 dark:text-white">Console</span> tab.</li>
            <li>Paste, press Enter, and leave the tab open. It prints each sale as it goes.</li>
            <li>It saves a file to your Downloads every {COLLECTOR_FILE_MB} MB, named <span className="font-mono text-xs">vectis-bc-lots-01.json</span> and so on. Chrome may ask once whether to allow several downloads — say yes.</li>
          </ol>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Safe to stop and re-run: it remembers where it got to and carries on. To stop it early, type <span className="font-mono">vectisStop()</span> and press Enter.
          </p>
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">Show the script (if the copy button will not work)</summary>
            <textarea readOnly value={script} rows={10} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0D0D0F] p-2 font-mono text-[11px] text-gray-800 dark:text-gray-200" />
          </details>
        </div>

        {/* ─── Step 3 ─────────────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <div className="font-semibold text-gray-900 dark:text-white">3. Load the files back here</div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file" accept=".json,application/json" multiple disabled={busy}
              onChange={e => { setFiles(Array.from(e.target.files ?? [])); setDone(null); setError(null); setProblems([]) }}
              className="file-input"
            />
            <button type="button" onClick={load} disabled={busy || !files.length} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>
              {busy ? "Loading…" : `Load ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
            </button>
          </div>

          {busy && (
            <div className="rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-sm">
              File {at} of {files.length} · {lots.toLocaleString()} lots loaded so far across {sales.toLocaleString()} sales
            </div>
          )}
          {done && !busy && (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{done}</div>
          )}
          {error && (
            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
          )}
          {problems.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
              {problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
        </div>
      </div>
    </details>
  )
}
