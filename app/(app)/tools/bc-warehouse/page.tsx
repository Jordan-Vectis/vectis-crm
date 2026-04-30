"use client"

import { useState, useEffect, useCallback } from "react"
import Logo from "@/components/logo"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LabelList, ResponsiveContainer, Cell,
} from "recharts"
import * as XLSX from "xlsx"

// ─── Types ────────────────────────────────────────────────────────────────────

type WhData = {
  byCategory:   { category: string; count: number }[]
  byCataloguer: { cataloguer: string; count: number }[]
  raw:          { category: string; cataloguer: string; catalogued: boolean; barcode: string; description: string }[]
  meta:         { total: number; openTotes: number; categoryCount: number; largestCategory: string }
}

type HeatTote = { id: string; description: string; category: string; catalogued: boolean; location: string; type?: "tote" | "barcode" }
type HeatLocation = { code: string; total: number; catalogued: number; uncatalogued: number; items: HeatTote[] }
type HeatData = {
  locations: HeatLocation[]
  unlocated: HeatLocation
  meta: { totalTotes: number; totalLocations: number; occupiedLocations: number; directField: string | null }
}

type ChecklistLot = { lotNumber: string; barcode: string; title: string; location: string | null }
type ChecklistAuction = { code: string; name: string; date: string | null; lots: ChecklistLot[] }

type Report = "warehouse" | "location" | "heatmap" | "sale-checklist" | "search"

// ─── Session cache ────────────────────────────────────────────────────────────
// Stores loaded data in sessionStorage so navigating away and back skips the fetch.
// TTL: 30 minutes. Clear with clearSessionCache() or the REFRESH ALL DATA button.

const CACHE_TTL_MS = 30 * 60 * 1000

function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem(key); return null }
    return data as T
  } catch { return null }
}

function writeCache(key: string, data: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch { /* storage full — skip */ }
}

function clearSessionCache() {
  try {
    sessionStorage.removeItem("bc_heatmap")
    sessionStorage.removeItem("bc_sale_checklist")
  } catch { /* ignore */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exportXlsx(rows: object[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Report")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

async function readStream(
  url: string,
  onStage:    (label: string) => void,
  onProgress: (done: number, total: number, label: string, raw?: any) => void,
  onResult:   (data: any) => void,
  onError:    (msg: string) => void,
) {
  const res = await fetch(url)

  // Handle non-streaming error responses (e.g. 401, 503 JSON from the route guard)
  if (!res.ok || !res.body) {
    let errMsg = `HTTP ${res.status}`
    try {
      const text = await res.text()
      const j = JSON.parse(text)
      errMsg = j.error ?? j.message ?? errMsg
    } catch { /* use status code */ }
    onError(errMsg)
    return
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split("\n"); buf = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.type === "stage")    onStage(msg.label)
        if (msg.type === "progress") onProgress(msg.done, msg.total, msg.label ?? "", msg)
        if (msg.type === "result")   onResult(msg.data)
        if (msg.type === "error")    onError(msg.message)
        // Handle plain BC JSON errors that lack a `type` field
        if (!msg.type && msg.error)  onError(msg.error)
      } catch { /* ignore malformed lines */ }
    }
  }
}

// ─── Shared components ────────────────────────────────────────────────────────

function HBar({ data, valueKey, labelKey }: { data: object[]; valueKey: string; labelKey: string }) {
  if (!data.length) return <p className="text-gray-500 text-sm py-6 text-center">No data</p>
  const barH   = Math.max(28, Math.min(48, 600 / data.length))
  const chartH = data.length * barH + 50
  return (
    <ResponsiveContainer width="100%" height={chartH}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 180, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e2130" />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey={labelKey} width={175} tick={{ fontSize: 12, fill: "#c8c8d8" }} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{ background: "#1c1f27", border: "1px solid #2d3047", borderRadius: 6, fontSize: 13, color: "#fff" }} />
        <Bar dataKey={valueKey} radius={[0, 3, 3, 0]} maxBarSize={36}>
          {data.map((_, i) => <Cell key={i} fill="#0078D4" />)}
          <LabelList dataKey={valueKey} position="right" style={{ fontSize: 12, fill: "#c8c8d8" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function SubTabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 mb-5">
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            active === t ? "bg-[#0078D4] text-white" : "text-gray-400 hover:text-gray-200 bg-[#0d0f1a] border border-gray-700"
          }`}>
          {t}
        </button>
      ))}
    </div>
  )
}

function LoadBtn({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50">
      {loading ? "Loading…" : "↺ Reload"}
    </button>
  )
}

function ProgressBar({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : null
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
        <span>{label ?? "Fetching data…"}</span>
        <span>{pct !== null ? `${done.toLocaleString()} / ${total.toLocaleString()} (${pct}%)` : `${done.toLocaleString()}…`}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-[#0078D4] rounded-full transition-all duration-300"
          style={{ width: pct !== null ? `${pct}%` : "40%" }} />
      </div>
    </div>
  )
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-[#0d0f1a] border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-xs font-medium rounded transition-colors">
      ⬇ Export to Excel
    </button>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-red-950 border border-red-700 rounded-xl p-5 max-w-lg">
      <p className="text-red-300 font-semibold text-sm mb-1">Error loading data</p>
      <p className="text-red-400 text-xs mb-3 font-mono break-all">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs rounded transition-colors">
          ↺ Retry
        </button>
      )}
    </div>
  )
}

// ─── Heatmap helpers ──────────────────────────────────────────────────────────

function heatColour(count: number, max: number): string {
  if (count === 0) return "bg-[#1a1d2e] border-gray-800 text-gray-600"
  const ratio = count / Math.max(max, 1)
  if (ratio < 0.25) return "bg-emerald-950 border-emerald-800 text-emerald-300"
  if (ratio < 0.5)  return "bg-yellow-950 border-yellow-700 text-yellow-300"
  if (ratio < 0.75) return "bg-orange-950 border-orange-700 text-orange-300"
  return "bg-red-950 border-red-700 text-red-300"
}

function parseGrid(locations: HeatLocation[]) {
  const parsed = locations.map(loc => {
    const m = loc.code.match(/^([A-Za-z]+)[^0-9]*([0-9]+)$/)
    return m ? { ...loc, row: m[1].toUpperCase(), col: parseInt(m[2]) } : null
  })
  if (parsed.some(p => p === null)) return null
  const rows = [...new Set(parsed.map(p => p!.row))].sort()
  const cols = [...new Set(parsed.map(p => p!.col))].sort((a, b) => a - b)
  const grid = new Map(parsed.map(p => [`${p!.row}${p!.col}`, p!]))
  return { rows, cols, grid }
}

// ─── Nav items ────────────────────────────────────────────────────────────────

type NavItem = { id: Report; label: string; activeColor: string; icon: string }

const NAV: NavItem[] = [
  {
    id: "warehouse", label: "Tote Data", activeColor: "text-orange-400",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    id: "sale-checklist", label: "Sale Checklist", activeColor: "text-green-400",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  },
  {
    id: "search", label: "Search by Location", activeColor: "text-sky-400",
    icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  },
  {
    id: "location", label: "Location History", activeColor: "text-blue-400",
    icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    id: "heatmap", label: "Warehouse Map", activeColor: "text-orange-400",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
]

function SidebarBtn({ r, active, onClick }: { r: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
        active ? "bg-white/8 text-white" : "text-gray-500 hover:text-gray-200 hover:bg-white/5"
      }`}>
      <svg className={`w-4 h-4 flex-shrink-0 ${active ? r.activeColor : "text-gray-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={r.icon} />
      </svg>
      <span className={`text-sm ${active ? "font-medium text-white" : "font-normal"}`}>{r.label}</span>
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BcWarehousePage() {
  const [activeReport, setActiveReport] = useState<Report>("warehouse")
  const [isConnected, setConnected]     = useState<boolean | null>(null)
  const [bcError, setBcError]           = useState<string | null>(null)
  const [debugReason, setDebugReason]   = useState<string | null>(null)
  const [refreshKey, setRefreshKey]     = useState(0)

  // Heatmap state lifted to page level so both Map and Search tabs share it
  const [heatData, setHeatData]         = useState<HeatData | null>(null)
  const [heatLoading, setHeatLoading]   = useState(false)
  const [heatError, setHeatError]       = useState<string | null>(null)
  const [heatStage, setHeatStage]       = useState("")
  const [heatProgress, setHeatProgress] = useState<{ done: number; total: number; label: string; found?: number; page?: number; scanned?: number } | null>(null)

  const loadHeatmap = useCallback(async (bustCache = false) => {
    // Check session cache first (skip on explicit reload)
    if (!bustCache) {
      const cached = readCache<HeatData>("bc_heatmap")
      if (cached) { setHeatData(cached); return }
    }

    setHeatLoading(true); setHeatError(null); setHeatProgress(null); setHeatStage("Connecting…")
    try {
      await readStream(
        "/api/bc/warehouse-heatmap",
        label => { setHeatStage(label); setHeatProgress(null) },
        (done, total, label, raw) => setHeatProgress({ done, total, label, found: raw?.found, page: raw?.page, scanned: raw?.scanned }),
        data => { setHeatData(data); writeCache("bc_heatmap", data) },
        msg  => setHeatError(msg),
      )
    } catch (e: any) {
      setHeatError(e?.message ?? String(e))
    } finally {
      setHeatLoading(false)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("bc_error")) setBcError(params.get("bc_error"))
    window.fetch("/api/bc/status")
      .then(r => r.json())
      .then(data => {
        setConnected(data.connected === true)
        if (!data.connected) setDebugReason(data.reason ?? null)
      })
      .catch(() => setConnected(false))
  }, [])

  return (
    <div className="flex h-[calc(100vh-48px)] bg-[#07070f] text-white overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-48 bg-[#0b0d14] border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-800">
          <Logo variant="compact" />
          <p className="text-gray-600 text-xs mt-1">BC Warehouse</p>
        </div>
        <div className="flex-1 px-2 py-4 flex flex-col">
          <p className="text-gray-600 text-[10px] uppercase tracking-widest mb-1.5 px-2">Sections</p>
          <div className="space-y-0.5">
            {NAV.map(r => (
              <SidebarBtn key={r.id} r={r} active={activeReport === r.id} onClick={() => setActiveReport(r.id)} />
            ))}
          </div>
        </div>
        <div className="px-3 py-4 border-t border-gray-800 space-y-3">
          <div>
            <p className="text-gray-600 text-xs">Env: production</p>
            <p className="text-gray-600 text-xs">Company: Vectis</p>
          </div>
          <button
            onClick={async () => {
              clearSessionCache()
              await fetch("/api/bc/cache-bust", { method: "POST" }).catch(() => {})
              setHeatData(null); setHeatError(null)
              setRefreshKey(k => k + 1)
            }}
            className="w-full bg-red-700 hover:bg-red-600 text-white text-xs font-bold py-1.5 px-2 rounded transition-colors"
          >
            ■ REFRESH ALL DATA
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto p-6">
        {isConnected === null && <p className="text-gray-500 text-sm">Checking connection…</p>}

        {isConnected === false && (
          <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-6 max-w-sm">
            <h2 className="font-semibold text-white mb-1">Connect to Microsoft</h2>
            <p className="text-sm text-gray-400 mb-4">Sign in with your Microsoft 365 account to access Business Central data.</p>
            {bcError && <p className="text-sm text-red-400 mb-3 bg-red-950 border border-red-800 rounded p-2">{bcError}</p>}
            {debugReason && !bcError && <p className="text-xs text-gray-500 mb-3">Status: {debugReason}</p>}
            <a href="/api/bc/auth" className="inline-block bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors">
              Sign in with Microsoft
            </a>
          </div>
        )}

        {isConnected === true && (
          <div key={refreshKey}>
            {activeReport === "warehouse"      && <ToteDataTab />}
            {activeReport === "sale-checklist" && <SaleChecklistTab />}
            {activeReport === "search"         && (
              <SearchByLocationTab
                heatData={heatData} heatLoading={heatLoading} heatError={heatError}
                heatStage={heatStage} heatProgress={heatProgress} onLoad={loadHeatmap}
              />
            )}
            {activeReport === "location"  && <LocationHistoryTab />}
            {activeReport === "heatmap"   && (
              <WarehouseHeatmapTab
                data={heatData} loading={heatLoading} error={heatError}
                stageLabel={heatStage} progress={heatProgress} onLoad={loadHeatmap}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Tote Data tab (renamed from Warehouse) ───────────────────────────────────

function ToteDataTab() {
  const [data, setData]     = useState<WhData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [subTab, setSubTab] = useState("By Category")

  async function load() {
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch("/api/bc/warehouse")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Tote Data</h2>
      <button onClick={load} disabled={loading}
        className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50">
        {loading ? "Loading…" : "Load Snapshot"}
      </button>
      {error && <ErrorCard message={error} onRetry={load} />}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-[#0d0f1a] border border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Total Totes</p>
              <p className="text-xl font-bold text-white">{data.meta.total.toLocaleString()}</p>
            </div>
            <div className="bg-[#0d0f1a] border border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Categories</p>
              <p className="text-xl font-bold text-white">{data.meta.categoryCount.toLocaleString()}</p>
            </div>
            <div className="bg-[#0d0f1a] border border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Largest Category</p>
              <p className="text-sm font-semibold text-white truncate">{data.meta.largestCategory}</p>
            </div>
          </div>
          <SubTabs tabs={["By Category", "By Cataloguer", "Raw Data"]} active={subTab} onChange={setSubTab} />
          {subTab === "By Category"   && <><HBar data={data.byCategory} valueKey="count" labelKey="category" /><ExportBtn onClick={() => exportXlsx(data.byCategory, "warehouse_by_category")} /></>}
          {subTab === "By Cataloguer" && <><HBar data={data.byCataloguer} valueKey="count" labelKey="cataloguer" /><ExportBtn onClick={() => exportXlsx(data.byCataloguer, "warehouse_by_cataloguer")} /></>}
          {subTab === "Raw Data" && (
            <>
              <p className="text-xs text-gray-500 mb-3">{data.raw.length.toLocaleString()} totes</p>
              <div className="overflow-x-auto rounded border border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-[#0d0f1a] text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Barcode</th>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-left">Cataloguer</th>
                      <th className="px-4 py-2 text-left">Catalogued</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {data.raw.map((r, i) => (
                      <tr key={i} className="hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-500 font-mono text-xs">{r.barcode}</td>
                        <td className="px-4 py-2 text-gray-300">{r.category}</td>
                        <td className="px-4 py-2 text-gray-300">{r.cataloguer}</td>
                        <td className="px-4 py-2">{r.catalogued ? <span className="text-green-400 text-xs">✓ Yes</span> : <span className="text-gray-600 text-xs">No</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ExportBtn onClick={() => exportXlsx(data.raw, "warehouse_raw")} />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Sale Checklist tab ───────────────────────────────────────────────────────

function SaleChecklistTab() {
  const [data, setData]         = useState<ChecklistAuction[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [stageLabel, setStageLabel] = useState("")
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [openAuctions, setOpenAuctions] = useState<Set<string>>(new Set())
  const [filter, setFilter]     = useState<"all" | "located" | "missing">("all")

  async function load(bustCache = false) {
    if (!bustCache) {
      const cached = readCache<ChecklistAuction[]>("bc_sale_checklist")
      if (cached) {
        setData(cached)
        setOpenAuctions(new Set(cached.map(a => a.code)))
        return
      }
    }
    setLoading(true); setError(null); setProgress(null); setStageLabel("Connecting…")
    try {
      await readStream(
        "/api/bc/sale-checklist",
        label => { setStageLabel(label); setProgress(null) },
        (done, total, label) => { setStageLabel(label); setProgress({ done, total }) },
        d => {
          const auctions: ChecklistAuction[] = d.auctions ?? d
          setData(auctions)
          setOpenAuctions(new Set(auctions.map(a => a.code)))
          writeCache("bc_sale_checklist", auctions)
        },
        msg => setError(msg),
      )
    } catch (e: any) { setError(e?.message ?? String(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function toggleAuction(code: string) {
    setOpenAuctions(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Sale Checklist</h2>
      <p className="text-gray-500 text-sm mb-5">Lots grouped by auction — shows BC warehouse location for each lot barcode.</p>

      {loading && <ProgressBar done={progress?.done ?? 0} total={progress?.total ?? 0} label={stageLabel} />}
      {error && <ErrorCard message={error} onRetry={load} />}
      {!loading && data && <LoadBtn loading={loading} onClick={() => load(true)} />}

      {data && (
        <>
          {/* Summary */}
          {(() => {
            const totalLots   = data.reduce((s, a) => s + a.lots.length, 0)
            const locatedLots = data.reduce((s, a) => s + a.lots.filter(l => l.location).length, 0)
            return (
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-[#0d0f1a] border border-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Total Lots</p>
                  <p className="text-xl font-bold text-white">{totalLots.toLocaleString()}</p>
                </div>
                <div className="bg-[#0d0f1a] border border-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Located in BC</p>
                  <p className="text-xl font-bold text-emerald-400">{locatedLots.toLocaleString()}</p>
                </div>
                <div className="bg-[#0d0f1a] border border-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Missing Location</p>
                  <p className="text-xl font-bold text-red-400">{(totalLots - locatedLots).toLocaleString()}</p>
                </div>
              </div>
            )
          })()}

          {/* Filter */}
          <div className="flex gap-2 mb-4">
            {(["all", "located", "missing"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  filter === f ? "bg-[#0078D4] text-white" : "bg-[#0d0f1a] border border-gray-700 text-gray-400 hover:text-white"
                }`}>
                {f === "all" ? "All lots" : f === "located" ? "✓ Located" : "⚠ Missing location"}
              </button>
            ))}
          </div>

          {/* Auctions */}
          <div className="space-y-3">
            {data.map(auction => {
              const filteredLots = auction.lots.filter(l =>
                filter === "all" ? true : filter === "located" ? !!l.location : !l.location
              )
              if (filteredLots.length === 0) return null
              const located  = auction.lots.filter(l => l.location).length
              const total    = auction.lots.length
              const pct      = total > 0 ? Math.round((located / total) * 100) : 0
              const isOpen   = openAuctions.has(auction.code)
              const auctionDate = auction.date ? new Date(auction.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "No date"

              return (
                <div key={auction.code} className="bg-[#0d0f1a] border border-gray-800 rounded-xl overflow-hidden">
                  {/* Header */}
                  <button onClick={() => toggleAuction(auction.code)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left">
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-white font-semibold text-sm">{auction.name || auction.code}</p>
                        <p className="text-gray-500 text-xs mt-0.5">{auction.code} · {auctionDate} · {total} lots</p>
                      </div>
                      {/* Progress pill */}
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-1.5 rounded-full ${pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-yellow-500" : "bg-red-500"}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-xs font-semibold ${pct === 100 ? "text-emerald-400" : pct > 50 ? "text-yellow-400" : "text-red-400"}`}>
                          {located}/{total}
                        </span>
                      </div>
                    </div>
                    <svg className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Lot table */}
                  {isOpen && (
                    <div className="border-t border-gray-800">
                      <table className="w-full text-xs">
                        <thead className="bg-[#07070f] text-gray-600 uppercase">
                          <tr>
                            <th className="px-4 py-2 text-left w-16">Lot</th>
                            <th className="px-4 py-2 text-left w-32">Barcode</th>
                            <th className="px-4 py-2 text-left">Title</th>
                            <th className="px-4 py-2 text-left w-32">BC Location</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-900">
                          {filteredLots.map((lot, i) => (
                            <tr key={i} className="hover:bg-white/3">
                              <td className="px-4 py-2 text-gray-400 font-mono">{lot.lotNumber || "—"}</td>
                              <td className="px-4 py-2 text-gray-500 font-mono">{lot.barcode || "—"}</td>
                              <td className="px-4 py-2 text-gray-300 truncate max-w-xs">{lot.title}</td>
                              <td className="px-4 py-2">
                                {lot.location
                                  ? <span className="text-emerald-400 font-mono font-semibold">{lot.location}</span>
                                  : <span className="text-red-400 opacity-70">No location</span>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Search by Location tab ───────────────────────────────────────────────────

function SearchByLocationTab({
  heatData, heatLoading, heatError, heatStage, heatProgress, onLoad,
}: {
  heatData: HeatData | null; heatLoading: boolean; heatError: string | null
  heatStage: string; heatProgress: { done: number; total: number; label: string; found?: number; page?: number; scanned?: number } | null
  onLoad: () => void
}) {
  const [query, setQuery] = useState("")

  const matchingLocations = heatData
    ? heatData.locations.filter(l => query.trim() && l.code.toLowerCase().includes(query.trim().toLowerCase()))
    : []
  const matchingTotes = matchingLocations.flatMap(l => l.items.map(i => ({ ...i, locationCode: l.code })))

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Search by Location</h2>
      <p className="text-gray-500 text-sm mb-5">
        Search a partial location code — e.g. <span className="font-mono text-gray-400">A21</span> matches A21A1, A21B2, etc.
      </p>

      {/* Load prompt if heatmap not loaded */}
      {!heatData && !heatLoading && !heatError && (
        <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-6 max-w-sm">
          <p className="text-gray-400 text-sm mb-3">Warehouse location data hasn't been loaded yet.</p>
          <button onClick={onLoad} className="px-4 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm rounded transition-colors">
            Load warehouse data
          </button>
        </div>
      )}

      {heatLoading && <HeatmapLoadingCard stage={heatStage} progress={heatProgress} />}
      {heatError && <ErrorCard message={heatError} onRetry={onLoad} />}

      {heatData && (
        <>
          {/* Search input */}
          <div className="flex gap-3 mb-5 max-w-sm">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. A21, SHELF, B3"
              autoFocus
              className="flex-1 bg-[#0d0f1a] border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            {query && (
              <button onClick={() => setQuery("")} className="px-3 text-gray-500 hover:text-white text-sm">✕</button>
            )}
          </div>

          {query.trim() && (
            <>
              <p className="text-xs text-gray-500 mb-3">
                {matchingLocations.length} location{matchingLocations.length !== 1 ? "s" : ""} matched · {matchingTotes.length} totes
              </p>

              {matchingLocations.length === 0 ? (
                <p className="text-gray-600 text-sm">No locations match <span className="font-mono text-gray-400">"{query}"</span></p>
              ) : (
                <div className="space-y-3">
                  {matchingLocations.map(loc => (
                    <div key={loc.code} className="bg-[#0d0f1a] border border-gray-800 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded ${heatColour(loc.total, Math.max(...(heatData?.locations.map(l => l.total) ?? [1])))}`}>
                            {loc.code}
                          </span>
                          <span className="text-gray-400 text-sm">{loc.total} totes</span>
                        </div>
                        <span className="text-xs text-gray-600">{loc.catalogued} catalogued · {loc.uncatalogued} open</span>
                      </div>
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-gray-900">
                          {loc.items.map(item => (
                            <tr key={item.id} className="hover:bg-white/3">
                              <td className="px-4 py-2 text-gray-400 font-mono w-36">{item.id}</td>
                              <td className="px-4 py-2 text-gray-500">{item.category || "—"}</td>
                              <td className="px-4 py-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${item.catalogued ? "bg-emerald-900 text-emerald-300" : "bg-gray-800 text-gray-500"}`}>
                                  {item.catalogued ? "Catalogued" : "Open"}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-400 truncate max-w-xs">{item.description || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Location History tab ─────────────────────────────────────────────────────

type LocationEntry = { from: string; to: string; changedBy: string; changedAt: string }

const SALESPERSON_NAMES: Record<string, string> = {
  AM: "Ashley McIntyre", AR: "Andrea Rowntree", AR2: "Andrew Reed", AROB: "Amelia Robson",
  AW: "Andrew Wilson", BC: "Bob Coulson", BG: "Bryan Goodall", BJ: "Becky Jones",
  BK: "Ben Kennington", CH: "Chris Hemingway", CW: "Chris Whan", DB: "Daniel Brakenbury",
  DC: "Debbie Cockerill", DL: "Daniel Lorraine", DP: "Dispatch", ED: "Edward Duffy",
  EG: "Ewan Gray", EW: "Eve Walker", GH: "Gill Harley", HW: "Harry Wheatley",
  ID: "Ian Dilley", IM: "Ian Main", JC: "Jack Collings", JG: "Jonathon Gouder",
  JK: "Jake Kenyon", JM: "Jo McDonald", JO: "Jordan Orange", JR: "Julian Royse",
  JS: "Jake Smithson", JW: "Julie Walker", KR: "Kay Rankin", KS: "Keiran Southgate",
  KT: "Kathy Taylor", LH: "Lesley Hill", LS: "Lisa Sutherland", MB: "Matt Bailey",
  MC: "Matthew Cotton", MD: "Mike Delaney", MF: "Mike Fishwick", MT: "Michelle Trotter",
  MV: "Melanie Vasey", ND: "Nick Dykes", NO: "Naomi O'Conner", OB: "Olivia Burley",
  PB: "Paul Beverley", PC: "Phil Cochrane", PD: "Peter Davis", PM: "Peter Morris",
  SC: "Simon Clarke", SCANNER: "Scanner", SF: "Steven Furlong", SM: "Sanaz Moghaddam",
  SR: "Stuart Redding", SS: "Simon Smith", TR: "Tim Routh", VA: "Vectis Accounts",
  VS: "Vanessa Stanton", WA: "Admin Warehouse", WR: "Wendy Robins",
}

function formatDateTime(iso: string) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch { return iso }
}

function LocationHistoryTab() {
  const [input, setInput]   = useState("")
  const [mode, setMode]     = useState<"tote" | "barcode">("tote")
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [result, setResult] = useState<{ field1: string; field2: string | null; entries: LocationEntry[] } | null>(null)

  async function lookup() {
    const q = input.trim()
    if (!q) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res  = await fetch(`/api/bc/location-history?q=${encodeURIComponent(q)}&mode=${mode}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Lookup failed"); return }
      setResult(data)
    } catch { setError("Network error") }
    finally { setLoading(false) }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Location History</h2>
      <p className="text-gray-500 text-sm mb-5">Look up every location a tote or lot has ever been moved to via BC change logs.</p>

      <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-5 max-w-lg space-y-4">
        <div className="flex gap-2">
          {(["tote", "barcode"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setResult(null); setError(null) }}
              className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                mode === m ? "border-blue-500 bg-blue-500/20 text-blue-300" : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
              }`}>
              {m === "tote" ? "🗂 Tote number" : "🔖 Barcode"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && lookup()}
            placeholder={mode === "tote" ? "e.g. T000123" : "e.g. VEC-001234"} autoFocus
            className="flex-1 bg-[#07070f] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono" />
          <button onClick={lookup} disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
            {loading ? "Searching…" : "Look up"}
          </button>
        </div>
        {mode === "barcode" && <p className="text-xs text-gray-600">Barcode lookup does two BC queries: first finds the item key, then fetches all location changes for that item.</p>}
      </div>

      {error && <div className="mt-4 max-w-lg"><ErrorCard message={error} /></div>}

      {result && (
        <div className="mt-5 max-w-2xl space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">BC Item Key</p>
              <p className="text-white font-mono text-sm">{result.field1}{result.field2 ? ` · ${result.field2}` : ""}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Movements found</p>
              <p className="text-white font-semibold">{result.entries.length}</p>
            </div>
          </div>

          {result.entries.length === 0 ? (
            <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">No location changes found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-[#0d0f1a] text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left">From</th>
                    <th className="px-4 py-2.5 text-left">To</th>
                    <th className="px-4 py-2.5 text-left">Changed by</th>
                    <th className="px-4 py-2.5 text-left">Date / Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {result.entries.map((e, i) => (
                    <tr key={i} className={`hover:bg-[#0d0f1a] ${i === 0 ? "bg-blue-950/30" : ""}`}>
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{e.from || <span className="text-gray-600 italic">empty</span>}</td>
                      <td className="px-4 py-2 text-white font-mono text-xs font-semibold">{e.to || <span className="text-gray-600 italic">empty</span>}</td>
                      <td className="px-4 py-2 text-gray-300">{SALESPERSON_NAMES[e.changedBy] ?? e.changedBy}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs">{formatDateTime(e.changedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Warehouse Map tab ────────────────────────────────────────────────────────

function HeatmapLoadingCard({ stage, progress }: {
  stage: string
  progress: { done: number; total: number; label: string; found?: number; page?: number; scanned?: number } | null
}) {
  return (
    <div className="bg-[#0d0f1a] border border-gray-800 rounded-xl p-6 max-w-xl space-y-4">
      {/* Pulsing indicator */}
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
        </span>
        <p className="text-white text-sm font-medium">{stage || "Connecting…"}</p>
      </div>

      {/* Progress bar */}
      {progress && (
        <div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-[#0078D4] rounded-full transition-all duration-300"
              style={{ width: progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : "15%" }} />
          </div>
        </div>
      )}

      {/* Live counters */}
      {progress && (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-[#07070f] rounded-lg p-3">
            <p className="text-2xl font-bold text-blue-400 tabular-nums">{(progress.found ?? 0).toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">Items found</p>
          </div>
          <div className="bg-[#07070f] rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-300 tabular-nums">{(progress.page ?? 0).toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">Pages scanned</p>
          </div>
          <div className="bg-[#07070f] rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-300 tabular-nums">{((progress.scanned ?? 0) / 1000).toFixed(1)}k</p>
            <p className="text-xs text-gray-500 mt-1">Log entries read</p>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-600">Reading BC change log newest-first — this may take 30–60 seconds</p>
    </div>
  )
}

function WarehouseHeatmapTab({ data, loading, error, stageLabel, progress, onLoad }: {
  data: HeatData | null; loading: boolean; error: string | null
  stageLabel: string; progress: { done: number; total: number; label: string; found?: number; page?: number; scanned?: number } | null
  onLoad: (bust?: boolean) => void
}) {
  const [selected, setSelected] = useState<HeatLocation | null>(null)

  // Auto-load on first mount
  useEffect(() => { if (!data && !loading && !error) onLoad() }, [])

  if (error) return <ErrorCard message={error} onRetry={onLoad} />

  const max      = data ? Math.max(...data.locations.map(l => l.total), 1) : 1
  const gridData = data ? parseGrid(data.locations) : null
  const busiest  = data ? data.locations.reduce((a, b) => a.total > b.total ? a : b, { code: "—", total: 0 } as any) : null

  function BigNum({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
      <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl px-5 py-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-bold text-white">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Warehouse Map</h2>
      <p className="text-gray-500 text-sm mb-5">Tote occupancy per BC location — current position based on BC location change log.</p>

      {loading && <HeatmapLoadingCard stage={stageLabel} progress={progress} />}
      {!loading && data && <LoadBtn loading={loading} onClick={() => onLoad(true)} />}

      {data && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <BigNum label="Total totes" value={data.meta.totalTotes} />
          <BigNum label="Locations" value={`${data.meta.occupiedLocations} / ${data.meta.totalLocations}`} sub="occupied / total" />
          <BigNum label="Busiest location" value={busiest?.code ?? "—"} sub={`${max} totes`} />
          <BigNum label="No location" value={data.unlocated.total} sub="not yet placed in BC" />
        </div>

        <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
          <span>Occupancy:</span>
          {[
            { label: "Empty",  cls: "bg-[#1a1d2e] border-gray-700" },
            { label: "Low",    cls: "bg-emerald-900 border-emerald-700" },
            { label: "Medium", cls: "bg-yellow-900 border-yellow-600" },
            { label: "High",   cls: "bg-orange-900 border-orange-600" },
            { label: "Full",   cls: "bg-red-900 border-red-600" },
          ].map(({ label, cls }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-4 h-4 rounded border ${cls}`} />
              <span>{label}</span>
            </div>
          ))}
        </div>

        {gridData ? (
          <div className="mb-6 overflow-x-auto">
            <table className="border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="w-8" />
                  {gridData.cols.map(c => <th key={c} className="text-xs text-gray-600 font-normal text-center w-14">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {gridData.rows.map(row => (
                  <tr key={row}>
                    <td className="text-xs text-gray-600 font-normal pr-1 text-right">{row}</td>
                    {gridData.cols.map(col => {
                      const loc = gridData.grid.get(`${row}${col}`)
                      if (!loc) return <td key={col}><div className="w-14 h-12 rounded border border-dashed border-gray-800/40" /></td>
                      return (
                        <td key={col}>
                          <button onClick={() => setSelected(selected?.code === loc.code ? null : loc)}
                            title={`${loc.code}: ${loc.total} totes`}
                            className={`w-14 h-12 rounded border transition-all hover:scale-105 flex flex-col items-center justify-center gap-0.5 ${heatColour(loc.total, max)} ${selected?.code === loc.code ? "ring-2 ring-white/50" : ""}`}>
                            <span className="text-[10px] font-bold leading-none">{loc.code}</span>
                            <span className="text-[9px] opacity-70 leading-none">{loc.total}</span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 mb-6">
            {data.locations.map(loc => (
              <button key={loc.code} onClick={() => setSelected(selected?.code === loc.code ? null : loc)}
                className={`rounded border p-2 text-center transition-all hover:scale-105 ${heatColour(loc.total, max)} ${selected?.code === loc.code ? "ring-2 ring-white/50" : ""}`}>
                <p className="text-[10px] font-bold truncate">{loc.code}</p>
                <p className="text-base font-bold">{loc.total}</p>
                {loc.uncatalogued > 0 && <p className="text-[9px] opacity-60">{loc.uncatalogued} open</p>}
              </button>
            ))}
          </div>
        )}

        {data.unlocated.total > 0 && (
          <button onClick={() => setSelected(selected?.code === "UNLOCATED" ? null : data.unlocated)}
            className={`mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all ${
              selected?.code === "UNLOCATED" ? "bg-gray-700 border-gray-500 text-white ring-2 ring-white/30" : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white"
            }`}>
            <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
            {data.unlocated.total} totes with no BC location
          </button>
        )}

        {selected && (
          <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-white font-semibold text-base">{selected.code === "UNLOCATED" ? "No Location" : `Location ${selected.code}`}</h3>
                <p className="text-gray-500 text-xs mt-0.5">{selected.total} totes — {selected.catalogued} catalogued, {selected.uncatalogued} open</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-800">
                    <th className="text-left pb-2 pr-4">ID / Barcode</th>
                    <th className="text-left pb-2 pr-4">Type</th>
                    <th className="text-left pb-2 pr-4">Catalogued</th>
                    <th className="text-left pb-2">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {selected.items.map(item => (
                    <tr key={item.id} className="text-gray-300 hover:bg-white/5">
                      <td className="py-1.5 pr-4 font-mono text-xs text-gray-400">{item.id}</td>
                      <td className="py-1.5 pr-4">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.type === "barcode" ? "bg-purple-900 text-purple-300" : "bg-blue-900 text-blue-300"}`}>
                          {item.type === "barcode" ? "Barcode" : "Tote"}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${item.catalogued ? "bg-emerald-900 text-emerald-300" : "bg-gray-800 text-gray-400"}`}>
                          {item.catalogued ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="py-1.5 text-gray-400 text-xs truncate max-w-xs">{item.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data.locations.filter(l => l.total > 0).length > 0 && (
          <div className="mt-2">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Occupancy by Location</h3>
            <div className="space-y-1.5">
              {[...data.locations].filter(l => l.total > 0).sort((a, b) => b.total - a.total).map(loc => (
                <div key={loc.code} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-16 text-right shrink-0">{loc.code}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className={`h-2 rounded-full transition-all ${
                      loc.total / max < 0.25 ? "bg-emerald-500" : loc.total / max < 0.5 ? "bg-yellow-500" : loc.total / max < 0.75 ? "bg-orange-500" : "bg-red-500"
                    }`} style={{ width: `${(loc.total / max) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-8 text-right shrink-0">{loc.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>}
    </div>
  )
}
