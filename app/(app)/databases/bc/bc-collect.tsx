"use client"

import { useState } from "react"
import { bcCollectorScript, COLLECTOR_FILE_MB, BC_FIRST_SITE_SALE, BC_LAST_SITE_SALE } from "@/lib/bc-web-collector"

// Databases → BC Database → "Load lot files collected from the website".
//
// ⚠⚠ WHY THIS PANEL EXISTS. The website answers the Hub's server with 202 and an empty body for
// every sale, while the same request from a machine in the office returns the lots. Business
// Central holds the full description and the photo path but publishes neither, and there is no
// development time to change that. So the collecting happens on an office machine and the files it
// writes are loaded here.
//
// ⚠ LAYOUT: the upload comes FIRST because that is the part that gets used. Collecting the files is
// done once, so the script that does it sits behind a toggle rather than three numbered steps
// standing between Jordan and the button he actually needs (2026-09-09: "its become a mess UI wise").
//
// ⚠ Files are sent ONE AT A TIME, with a count that moves (RULES §7b). A single 139 MB post shows
// nothing while it runs and would be cut off by Railway's 20 MB body limit anyway.
export default function BcCollect({ defaultFrom, defaultTo, collectedTo }: { defaultFrom: number; defaultTo: number; collectedTo: number | null }) {
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
  const totalMb = files.reduce((n, x) => n + x.size, 0) / 1048576

  async function copy() {
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 4000)
    } catch {
      setError("This browser would not let the page copy for you — open “Show the script” and copy it by hand.")
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
        ? "Nothing was loaded — the files held no Business Central lots. Check the collector reached the recent sales."
        : `Loaded ${totalLots.toLocaleString()} lot${totalLots === 1 ? "" : "s"} across ${totalSales.toLocaleString()} sale${totalSales === 1 ? "" : "s"}. Refresh the page to see them, then press Copy BC photos above to bring their pictures in.`)
    } catch (e: any) {
      setError(e?.message ?? "Could not load the files")
    } finally {
      setBusy(false)
    }
  }

  const box = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white focus:outline-none focus:border-violet-500"
  const btn = "min-h-[44px] inline-flex items-center px-4 rounded-lg font-semibold disabled:opacity-50"
  const why = "cursor-pointer text-xs text-gray-500 dark:text-gray-400 hover:text-violet-500"

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">📥 Load lot files collected from the website</h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file" accept=".json,application/json" multiple disabled={busy}
            onChange={e => { setFiles(Array.from(e.target.files ?? [])); setDone(null); setError(null); setProblems([]) }}
            className="file-input"
          />
          <button type="button" onClick={load} disabled={busy || !files.length} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>
            {busy ? "Loading…" : files.length ? `Load ${files.length} file${files.length === 1 ? "" : "s"}` : "Load files"}
          </button>
        </div>
      </div>

      {/* ⚠ NEXT TIME. The website's sale number is stored with every lot, so the page can say how
          far the collection got and start the next run at the sale after it. Without it, "do it
          again in a month" means somebody remembering a number. */}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {collectedTo
          ? <>Collected up to the website&rsquo;s sale <span className="font-mono">{collectedTo}</span>. To pick up the sales held since, collect from <span className="font-mono">{collectedTo + 1}</span> — the script below is already set to it — then load the files here. Sales already in are updated, never duplicated, so going over old ones again only fills in what was blank, such as a hammer price on a sale that has since been held.</>
          : <>Nothing has been loaded yet. Collect from sale <span className="font-mono">{defaultFrom}</span> onwards with the script below, then choose the files here.</>}
      </p>

      {!busy && !done && files.length > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{files.length} file{files.length === 1 ? "" : "s"} chosen · {totalMb.toFixed(0)} MB. They go up one at a time.</p>
      )}
      {busy && (
        <div className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
          <div className="flex flex-wrap justify-between gap-2 mb-1">
            <span>File {at} of {files.length} — {lots.toLocaleString()} lots loaded across {sales.toLocaleString()} sales</span>
            <span className="font-mono shrink-0">{Math.round((at / Math.max(1, files.length)) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500 transition-all" style={{ width: `${(at / Math.max(1, files.length)) * 100}%` }} /></div>
        </div>
      )}
      {done && !busy && <p className="text-sm text-emerald-700 dark:text-emerald-300">{done}</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-300">⚠ {error}</p>}
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
          {problems.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}

      <details>
        <summary className={why}>How the files are collected</summary>
        <div className="mt-2 space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <p>
            The website will not answer the Hub&rsquo;s server — every sale comes back empty — but it answers a browser
            on the office network normally. So the lots are collected on an office machine and loaded back here.
            They go in through the same route the automatic pull uses, so the two can never disagree.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">First sale</span>
              <input value={from} onChange={e => setFrom(e.target.value)} inputMode="numeric" className={`${box} w-28`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Last sale</span>
              <input value={to} onChange={e => setTo(e.target.value)} inputMode="numeric" className={`${box} w-28`} />
            </label>
            <button type="button" onClick={copy} className={`${btn} border border-gray-300 dark:border-gray-700 hover:border-violet-500`}>
              {copied ? "✓ Copied" : "📋 Copy script"}
            </button>
          </div>
          <p className="text-xs">
            These are the website&rsquo;s own sale numbers, not our sale codes. Business Central sales run from site
            number {BC_FIRST_SITE_SALE} to {BC_LAST_SITE_SALE}; sales with no BC lots are skipped in one small request.
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open <a href="https://www.vectis.co.uk" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">www.vectis.co.uk ↗</a> on an office machine.</li>
            <li>Press <span className="font-semibold text-gray-900 dark:text-white">F12</span>, click the <span className="font-semibold text-gray-900 dark:text-white">Console</span> tab, paste and press Enter.</li>
            <li>Leave the tab open. It prints each sale, and saves a file to Downloads every {COLLECTOR_FILE_MB} MB. Red 500 lines are normal — that is the site saying there is no sale with that number.</li>
            <li>Then choose those files above and press Load. Safe to stop and re-run: type <span className="font-mono">vectisStop()</span>, and next time it carries on where it stopped.</li>
          </ol>
          <details>
            <summary className={why}>Show the script (if the copy button will not work)</summary>
            <textarea readOnly value={script} rows={10} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0D0D0F] p-2 font-mono text-[11px] text-gray-800 dark:text-gray-200" />
          </details>
        </div>
      </details>
    </div>
  )
}
