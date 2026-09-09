"use client"

import { useEffect, useState, type ReactNode } from "react"

// The admin tools on the ABC Database page, as a row of small chips — the same shape as the BC
// Database page's BcTools (Jordan, 2026-09-09: "these should be really small options at the top
// that then show the square they need otherwise they should be hidden", and then "you have only
// fixed the UI in the BC database not in the ABC as well").
//
// ⚠ ONE panel at a time. Three panels stacked open is what made the page a wall — the lots
// themselves, which is what the page is for, started below the fold.
//
// ⚠ A RUNNING JOB OPENS ITSELF. Hiding the tools must not hide a job that is going: one read of
// the job state on mount opens the Website jobs panel if either is running, and the chip keeps a
// live dot either way. Without that, closing the panel would look exactly like the job stopping.
// The job rows are shared with the BC page (ArchiveJob "site"/"photos"), so this is the same probe.
export default function ArchiveTools({ importPanel, jobs, exportPanel }: { importPanel: ReactNode; jobs: ReactNode; exportPanel: ReactNode }) {
  const [open, setOpen] = useState<"import" | "jobs" | "export" | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        const r = await fetch("/api/databases/archive/site-pull")
        if (!r.ok || gone) return
        const j = await r.json()
        const on = !!(j?.site?.running || j?.photos?.running)
        if (gone) return
        setRunning(on)
        if (on) setOpen("jobs")
      } catch {}
    })()
    return () => { gone = true }
  }, [])

  const chip = (key: "import" | "jobs" | "export", label: string) => (
    <button
      type="button"
      onClick={() => setOpen(open === key ? null : key)}
      aria-expanded={open === key}
      className={`min-h-[40px] px-3 rounded-lg border text-sm transition-colors ${
        open === key
          ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-semibold"
          : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-500"
      }`}
    >
      {label}
      {key === "jobs" && running && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-violet-500 animate-pulse align-middle" title="A job is running" />}
    </button>
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-1">Tools</span>
        {chip("import", "📄 Import the spreadsheet")}
        {chip("jobs", "🌐 Website jobs")}
        {chip("export", "⬇ Export & handover")}
      </div>
      {open === "import" && importPanel}
      {open === "jobs" && jobs}
      {open === "export" && exportPanel}
    </div>
  )
}
