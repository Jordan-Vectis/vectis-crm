"use client"

import { useState, useEffect } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LabelList, ResponsiveContainer, Cell,
} from "recharts"
import * as XLSX from "xlsx"

// ─── Types ────────────────────────────────────────────────────────────────────

type CatData = {
  dailyAvg:  { user: string; avg: number }[]
  totalLots: { user: string; total: number }[]
  monthly:   { label: string; sort: string; total: number }[]
  meta:      { total: number; userCount: number }
}
type PackData = {
  dailyAvgCollections: { staff: string; avg: number }[]
  totalCollections:    { staff: string; total: number }[]
  dailyAvgLots:        { staff: string; avg: number }[]
  totalLots:           { staff: string; total: number }[]
  raw:                 { date: string; staff: string; docNo: string; lotCount: number }[]
  meta:                { total: number; staffCount: number }
}
type WhData = {
  byCategory:   { category: string; count: number }[]
  byCataloguer: { cataloguer: string; count: number }[]
  meta:         { total: number; openTotes: number }
}

type Report = "cataloguing" | "packing" | "warehouse"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today()      { return new Date().toISOString().split("T")[0] }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]
}
function startOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0]
}
function startOfYear() { return new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0] }
function lastMonthRange(): [string, string] {
  const d = new Date()
  const end   = new Date(d.getFullYear(), d.getMonth(), 0)
  const start = new Date(end.getFullYear(), end.getMonth(), 1)
  return [start.toISOString().split("T")[0], end.toISOString().split("T")[0]]
}
function exportXlsx(rows: object[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Report")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function HBar({ data, valueKey, labelKey }: { data: object[]; valueKey: string; labelKey: string }) {
  if (!data.length) return <p className="text-gray-500 text-sm py-6 text-center">No data</p>
  const barH  = Math.max(28, Math.min(48, 600 / data.length))
  const chartH = data.length * barH + 50
  return (
    <ResponsiveContainer width="100%" height={chartH}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 180, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e2130" />
        <XAxis
          type="number" tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false} axisLine={false}
          label={{ value: valueKey, position: "insideBottom", offset: -10, fill: "#6b7280", fontSize: 11 }}
        />
        <YAxis
          type="category" dataKey={labelKey} width={175}
          tick={{ fontSize: 12, fill: "#c8c8d8" }} tickLine={false} axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{ background: "#1c1f27", border: "1px solid #2d3047", borderRadius: 6, fontSize: 13, color: "#fff" }}
        />
        <Bar dataKey={valueKey} radius={[0, 3, 3, 0]} maxBarSize={36}>
          {data.map((_, i) => <Cell key={i} fill="#0078D4" />)}
          <LabelList dataKey={valueKey} position="right" style={{ fontSize: 12, fill: "#c8c8d8" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Date presets + range ─────────────────────────────────────────────────────

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const presets = [
    { label: "Last 7 days",  from: daysAgo(6),        to: today() },
    { label: "Last 30 days", from: daysAgo(29),        to: today() },
    { label: "This month",   from: startOfMonth(),      to: today() },
    { label: "Last month",   from: lastMonthRange()[0], to: lastMonthRange()[1] },
    { label: "This year",    from: startOfYear(),        to: today() },
  ]
  return (
    <div className="space-y-3 mb-4">
      <div className="flex gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.from, p.to)}
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
              from === p.from && to === p.to
                ? "bg-[#0078D4] text-white border-[#0078D4]"
                : "bg-[#0d0f1a] text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">From</label>
          <input
            type="date" value={from}
            onChange={(e) => onChange(e.target.value, to)}
            className="w-full bg-[#0d0f1a] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">To</label>
          <input
            type="date" value={to}
            onChange={(e) => onChange(from, e.target.value)}
            className="w-full bg-[#0d0f1a] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Sub tabs ─────────────────────────────────────────────────────────────────

function SubTabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 mb-5">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            active === t ? "bg-[#0078D4] text-white" : "text-gray-400 hover:text-gray-200 bg-[#0d0f1a] border border-gray-700"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

// ─── Meta bar ─────────────────────────────────────────────────────────────────

function MetaBar({ text }: { text: string }) {
  return <p className="text-xs text-gray-500 mb-4">{text}</p>
}

// ─── Load button ──────────────────────────────────────────────────────────────

function LoadBtn({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={loading}
      className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
    >
      {loading ? "Loading…" : "Load Report"}
    </button>
  )
}

// ─── Cataloguing tab ──────────────────────────────────────────────────────────

function CataloguingTab() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<CatData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [subTab, setSubTab]   = useState("Daily Average")

  async function load() {
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch(`/api/bc/cataloguing?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Cataloguing Report</h2>
      <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
      <LoadBtn loading={loading} onClick={load} />
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {data && (
        <>
          <MetaBar text={`${from} — ${to}  ·  ${data.meta.total.toLocaleString()} entries  ·  ${data.meta.userCount} users`} />
          <SubTabs tabs={["Daily Average", "Total Lots", "Lots by Month"]} active={subTab} onChange={setSubTab} />
          {subTab === "Daily Average" && <><HBar data={data.dailyAvg} valueKey="avg" labelKey="user" /><ExportBtn onClick={() => exportXlsx(data.dailyAvg, "cataloguing_daily_avg")} /></>}
          {subTab === "Total Lots"    && <><HBar data={data.totalLots} valueKey="total" labelKey="user" /><ExportBtn onClick={() => exportXlsx(data.totalLots, "cataloguing_total_lots")} /></>}
          {subTab === "Lots by Month" && <><HBar data={data.monthly} valueKey="total" labelKey="label" /><ExportBtn onClick={() => exportXlsx(data.monthly, "cataloguing_monthly")} /></>}
        </>
      )}
    </div>
  )
}

// ─── Packing tab ──────────────────────────────────────────────────────────────

function PackingTab() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<PackData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [subTab, setSubTab]   = useState("Collections Daily Avg")

  async function load() {
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch(`/api/bc/packing?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const subTabs = ["Collections Daily Avg", "Collections Total", "Lots Daily Avg", "Total Lots", "Raw Data"]

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Packing Report</h2>
      <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
      <LoadBtn loading={loading} onClick={load} />
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {data && (
        <>
          <MetaBar text={`${from} — ${to}  ·  ${data.meta.total.toLocaleString()} shipments  ·  ${data.meta.staffCount} staff`} />
          <SubTabs tabs={subTabs} active={subTab} onChange={setSubTab} />
          {subTab === "Collections Daily Avg" && <><HBar data={data.dailyAvgCollections} valueKey="avg" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.dailyAvgCollections, "packing_daily_avg")} /></>}
          {subTab === "Collections Total"     && <><HBar data={data.totalCollections} valueKey="total" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.totalCollections, "packing_total")} /></>}
          {subTab === "Lots Daily Avg"        && <><HBar data={data.dailyAvgLots} valueKey="avg" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.dailyAvgLots, "packing_lots_avg")} /></>}
          {subTab === "Total Lots"            && <><HBar data={data.totalLots} valueKey="total" labelKey="staff" /><ExportBtn onClick={() => exportXlsx(data.totalLots, "packing_total_lots")} /></>}
          {subTab === "Raw Data" && (
            <>
              <div className="overflow-x-auto rounded border border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-[#0d0f1a] text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Staff</th>
                      <th className="px-4 py-2 text-left">Document No</th>
                      <th className="px-4 py-2 text-right">Lot Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {data.raw.map((r, i) => (
                      <tr key={i} className="hover:bg-[#0d0f1a]">
                        <td className="px-4 py-2 text-gray-300">{r.date}</td>
                        <td className="px-4 py-2 text-gray-300">{r.staff}</td>
                        <td className="px-4 py-2 text-gray-500">{r.docNo}</td>
                        <td className="px-4 py-2 text-right text-gray-300">{r.lotCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ExportBtn onClick={() => exportXlsx(data.raw, "packing_raw")} />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Warehouse tab ────────────────────────────────────────────────────────────

function WarehouseTab() {
  const [data, setData] = useState<WhData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [subTab, setSubTab]   = useState("By Category")

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
      <h2 className="text-lg font-semibold text-white mb-4">Warehouse Report</h2>
      <button
        onClick={load} disabled={loading}
        className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
      >
        {loading ? "Loading…" : "Load Snapshot"}
      </button>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {data && (
        <>
          <MetaBar text={`${data.meta.total.toLocaleString()} total totes  ·  ${data.meta.openTotes.toLocaleString()} open`} />
          <SubTabs tabs={["By Category", "By Cataloguer"]} active={subTab} onChange={setSubTab} />
          {subTab === "By Category"   && <><HBar data={data.byCategory} valueKey="count" labelKey="category" /><ExportBtn onClick={() => exportXlsx(data.byCategory, "warehouse_by_category")} /></>}
          {subTab === "By Cataloguer" && <><HBar data={data.byCataloguer} valueKey="count" labelKey="cataloguer" /><ExportBtn onClick={() => exportXlsx(data.byCataloguer, "warehouse_by_cataloguer")} /></>}
        </>
      )}
    </div>
  )
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-[#0d0f1a] border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-xs font-medium rounded transition-colors"
    >
      ⬇ Export to Excel
    </button>
  )
}

// ─── Sidebar nav items ────────────────────────────────────────────────────────

const reports: { id: Report; label: string; color: string; dot: string }[] = [
  { id: "cataloguing", label: "Cataloguing", color: "text-red-400",    dot: "bg-red-500"    },
  { id: "packing",     label: "Packing",     color: "text-orange-400", dot: "bg-orange-500" },
  { id: "warehouse",   label: "Warehouse",   color: "text-green-400",  dot: "bg-green-500"  },
]

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BCReportsPage() {
  const [activeReport, setActiveReport] = useState<Report>("cataloguing")
  const [isConnected, setConnected]     = useState<boolean | null>(null)
  const [bcError, setBcError]           = useState<string | null>(null)
  const [debugReason, setDebugReason]   = useState<string | null>(null)
  const [refreshKey, setRefreshKey]     = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("bc_error")) setBcError(params.get("bc_error"))
    window.fetch("/api/bc/status")
      .then((r) => r.json())
      .then((data) => {
        setConnected(data.connected === true)
        if (!data.connected) setDebugReason(data.reason ?? null)
      })
      .catch(() => setConnected(false))
  }, [])

  return (
    <div className="flex h-[calc(100vh-48px)] bg-[#07070f] text-white overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-44 bg-[#0b0d14] border-r border-gray-800 flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-800">
          <p className="text-white font-bold text-base">Vectis</p>
          <p className="text-gray-600 text-xs mt-0.5">BC Reports</p>
        </div>

        {/* Reports nav */}
        <div className="flex-1 px-3 py-4">
          <p className="text-gray-600 text-xs uppercase tracking-wider mb-2 px-1">Reports</p>
          <div className="space-y-0.5">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveReport(r.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded text-sm font-medium transition-colors text-left ${
                  activeReport === r.id
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/50"
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.dot}`} />
                <span className={activeReport === r.id ? "text-white" : r.color}>{r.label.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="px-3 py-4 border-t border-gray-800 space-y-3">
          <div>
            <p className="text-gray-600 text-xs">Env: production</p>
            <p className="text-gray-600 text-xs">Company: Vectis</p>
          </div>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="w-full bg-red-700 hover:bg-red-600 text-white text-xs font-bold py-1.5 px-2 rounded transition-colors"
          >
            ■ REFRESH ALL DATA
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto p-6">
        {isConnected === null && (
          <p className="text-gray-500 text-sm">Checking connection…</p>
        )}

        {isConnected === false && (
          <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-6 max-w-sm">
            <h2 className="font-semibold text-white mb-1">Connect to Microsoft</h2>
            <p className="text-sm text-gray-400 mb-4">
              Sign in with your Microsoft 365 account to access Business Central data.
            </p>
            {bcError && (
              <p className="text-sm text-red-400 mb-3 bg-red-950 border border-red-800 rounded p-2">{bcError}</p>
            )}
            {debugReason && !bcError && (
              <p className="text-xs text-gray-500 mb-3">Status: {debugReason}</p>
            )}
            <a
              href="/api/bc/auth"
              className="inline-block bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              Sign in with Microsoft
            </a>
          </div>
        )}

        {isConnected === true && (
          <div key={refreshKey}>
            {activeReport === "cataloguing" && <CataloguingTab />}
            {activeReport === "packing"     && <PackingTab />}
            {activeReport === "warehouse"   && <WarehouseTab />}
          </div>
        )}
      </main>
    </div>
  )
}
