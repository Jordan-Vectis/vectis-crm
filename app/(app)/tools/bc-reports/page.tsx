"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Logo from "@/components/logo"
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
  raw:          { category: string; cataloguer: string; catalogued: boolean; barcode: string; description: string }[]
  meta:         { total: number; openTotes: number; categoryCount: number; largestCategory: string }
}

type Report = "cataloguing" | "packing" | "warehouse" | "explorer" | "location"

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

function DateRange({ from, to, onChange, onPreset }: {
  from: string; to: string
  onChange: (f: string, t: string) => void
  onPreset: (f: string, t: string) => void
}) {
  const presets = [
    { label: "Last 7 days",  from: daysAgo(6),         to: today() },
    { label: "Last 30 days", from: daysAgo(29),         to: today() },
    { label: "This month",   from: startOfMonth(),       to: today() },
    { label: "Last month",   from: lastMonthRange()[0],  to: lastMonthRange()[1] },
    { label: "This year",    from: startOfYear(),         to: today() },
  ]
  return (
    <div className="space-y-3 mb-4">
      <div className="flex gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => onPreset(p.from, p.to)}
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
      {loading ? "Loading…" : "↺ Reload"}
    </button>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="mb-5">
      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
        <span>Fetching data…</span>
        <span>{done} / {total} chunks ({pct}%)</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#0078D4] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Cataloguing tab ──────────────────────────────────────────────────────────

function CataloguingTab() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<CatData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [subTab, setSubTab]     = useState("Daily Average")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (f: string, t: string) => {
    if (!f || !t) return
    setLoading(true); setError(null); setProgress(null)
    // keep previous data visible while reloading
    try {
      const res = await window.fetch(`/api/bc/cataloguing?from=${f}&to=${t}`)
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? res.statusText) }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()!
        for (const line of lines) {
          if (!line.trim()) continue
          const msg = JSON.parse(line)
          if (msg.type === "progress") setProgress({ done: msg.done, total: msg.total })
          else if (msg.type === "result") setData(msg.data)
        }
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false); setProgress(null) }
  }, [])

  // Auto-load on first render
  useEffect(() => { load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleManualChange(f: string, t: string) {
    setFrom(f); setTo(t)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(f, t), 700)
  }

  function handlePreset(f: string, t: string) {
    setFrom(f); setTo(t)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    load(f, t)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Cataloguing Report</h2>
      <DateRange from={from} to={to} onChange={handleManualChange} onPreset={handlePreset} />

      {/* Progress bar sits above results — old data stays visible underneath */}
      {loading && progress && <ProgressBar done={progress.done} total={progress.total} />}
      {loading && !progress && <p className="text-xs text-gray-500 mb-4">Connecting…</p>}
      {!loading && <LoadBtn loading={loading} onClick={() => load(from, to)} />}

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {data && (
        <div className={loading ? "opacity-40 pointer-events-none transition-opacity" : "transition-opacity"}>
          <MetaBar text={`${from} — ${to}  ·  ${data.meta.total.toLocaleString()} entries  ·  ${data.meta.userCount} users`} />
          <SubTabs tabs={["Daily Average", "Total Lots", "Lots by Month"]} active={subTab} onChange={setSubTab} />
          {subTab === "Daily Average" && <><HBar data={data.dailyAvg} valueKey="avg" labelKey="user" /><ExportBtn onClick={() => exportXlsx(data.dailyAvg, "cataloguing_daily_avg")} /></>}
          {subTab === "Total Lots"    && <><HBar data={data.totalLots} valueKey="total" labelKey="user" /><ExportBtn onClick={() => exportXlsx(data.totalLots, "cataloguing_total_lots")} /></>}
          {subTab === "Lots by Month" && <><HBar data={data.monthly} valueKey="total" labelKey="label" /><ExportBtn onClick={() => exportXlsx(data.monthly, "cataloguing_monthly")} /></>}
        </div>
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (f: string, t: string) => {
    if (!f || !t) return
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch(`/api/bc/packing?from=${f}&to=${t}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleManualChange(f: string, t: string) {
    setFrom(f); setTo(t)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(f, t), 700)
  }

  function handlePreset(f: string, t: string) {
    setFrom(f); setTo(t)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    load(f, t)
  }

  const subTabs = ["Collections Daily Avg", "Collections Total", "Lots Daily Avg", "Total Lots", "Raw Data"]

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Packing Report</h2>
      <DateRange from={from} to={to} onChange={handleManualChange} onPreset={handlePreset} />
      {!loading && <LoadBtn loading={loading} onClick={() => load(from, to)} />}
      {loading && <p className="text-xs text-gray-500 mb-5">Loading…</p>}
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {data && (
        <div className={loading ? "opacity-40 pointer-events-none transition-opacity" : "transition-opacity"}>
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
        </div>
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

// ─── Data Explorer tab ────────────────────────────────────────────────────────

const ENDPOINTS: Record<string, string> = {
  "Auction Receipt Lines":  "Auction_Receipt_Lines_Excel",
  "Shipment Requests":      "ShipmentRequestAPI",
  "Collection List":        "CollectionList",
  "Posted Collection List": "PostedCollectionList",
  "Receipt Totes":          "Receipt_Totes_Excel",
}

function DataExplorerTab() {
  const [endpoint, setEndpoint] = useState(Object.keys(ENDPOINTS)[0])
  const [filter,   setFilter]   = useState("")
  const [orderby,  setOrderby]  = useState("")
  const [rows,     setRows]     = useState<any[] | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function fetch() {
    setLoading(true); setError(null); setRows(null)
    try {
      const params = new URLSearchParams({ endpoint: ENDPOINTS[endpoint] })
      if (filter)  params.set("filter",  filter)
      if (orderby) params.set("orderby", orderby)
      const res  = await window.fetch(`/api/bc/explorer?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setRows(json.rows)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const columns = rows && rows.length > 0
    ? Object.keys(rows[0]).filter(k => !k.startsWith("@odata"))
    : []

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Data Explorer</h2>

      <div className="flex gap-3 mb-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">Endpoint</label>
          <select
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="w-full bg-[#0d0f1a] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          >
            {Object.keys(ENDPOINTS).map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">OData $filter (optional)</label>
          <input
            type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="e.g. Status eq 'Open'"
            className="w-full bg-[#0d0f1a] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">Order by (optional)</label>
        <input
          type="text" value={orderby} onChange={(e) => setOrderby(e.target.value)}
          placeholder="e.g. No desc"
          className="w-full max-w-sm bg-[#0d0f1a] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>

      <button
        onClick={fetch} disabled={loading}
        className="mb-5 px-5 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
      >
        {loading ? "Loading…" : "Fetch Data"}
      </button>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {rows && (
        <>
          <p className="text-xs text-gray-500 mb-3">{rows.length.toLocaleString()} rows × {columns.length} columns</p>
          <div className="overflow-x-auto rounded border border-gray-800 mb-3" style={{ maxHeight: 520 }}>
            <table className="w-full text-xs">
              <thead className="bg-[#0d0f1a] text-gray-500 uppercase sticky top-0">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-left whitespace-nowrap font-semibold tracking-wider">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-[#0d0f1a]">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 text-gray-300 whitespace-nowrap">{String(r[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ExportBtn onClick={() => exportXlsx(rows, ENDPOINTS[endpoint])} />
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

// ─── Location History tab ─────────────────────────────────────────────────────

const SALESPERSON_NAMES_LOC: Record<string, string> = {
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

type LocationEntry = { from: string; to: string; changedBy: string; changedAt: string }

function formatDateTime(iso: string) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
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
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/bc/location-history?q=${encodeURIComponent(q)}&mode=${mode}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Lookup failed"); return }
      setResult(data)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") lookup()
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Location History</h2>
      <p className="text-gray-500 text-sm mb-5">Look up every location a tote or lot has ever been moved to via BC change logs.</p>

      {/* Input */}
      <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-5 max-w-lg space-y-4">

        {/* Mode toggle */}
        <div className="flex gap-2">
          {(["tote", "barcode"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setResult(null); setError(null) }}
              className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                mode === m
                  ? "border-blue-500 bg-blue-500/20 text-blue-300"
                  : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
              }`}>
              {m === "tote" ? "🗂 Tote number" : "🔖 Barcode"}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={mode === "tote" ? "e.g. T000123" : "e.g. VEC-001234"}
            autoFocus
            className="flex-1 bg-[#07070f] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
          />
          <button
            onClick={lookup}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? "Searching…" : "Look up"}
          </button>
        </div>

        {mode === "barcode" && (
          <p className="text-xs text-gray-600">
            Barcode lookup does two BC queries: first finds the item key from the barcode, then fetches all location changes for that item.
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 max-w-lg bg-red-950 border border-red-700 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-5 max-w-2xl space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">BC Item Key</p>
              <p className="text-white font-mono text-sm">
                {result.field1}{result.field2 ? ` · ${result.field2}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Movements found</p>
              <p className="text-white font-semibold">{result.entries.length}</p>
            </div>
          </div>

          {result.entries.length === 0 ? (
            <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">No location changes found in the BC change log.</p>
              <p className="text-gray-600 text-xs mt-1">The item may not have been moved, or the change log wasn't active when it was.</p>
            </div>
          ) : (
            <div className="bg-[#0d0f1a] border border-gray-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-[#07070f]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date / Time</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">From</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">To</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Changed by</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((e, i) => (
                    <tr key={i} className={`border-b border-gray-800/50 ${i % 2 === 0 ? "" : "bg-[#0a0c17]"}`}>
                      <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">{formatDateTime(e.changedAt)}</td>
                      <td className="px-4 py-2.5">
                        {e.from
                          ? <span className="font-mono text-gray-400">{e.from}</span>
                          : <span className="text-gray-700 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-blue-300">{e.to || "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">
                        {(SALESPERSON_NAMES_LOC[e.changedBy] ?? e.changedBy) || "—"}
                      </td>
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

// ─── Sidebar nav items ────────────────────────────────────────────────────────

const reports: { id: Report; label: string; color: string; dot: string }[] = [
  { id: "cataloguing", label: "Cataloguing",   color: "text-red-400",    dot: "bg-red-500"    },
  { id: "packing",     label: "Packing",       color: "text-orange-400", dot: "bg-orange-500" },
  { id: "warehouse",   label: "Warehouse",     color: "text-green-400",  dot: "bg-green-500"  },
  { id: "explorer",    label: "Data Explorer", color: "text-purple-400", dot: "bg-purple-500" },
  { id: "location",    label: "Loc. History",  color: "text-blue-400",   dot: "bg-blue-500"   },
]

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BCReportsPage() {
  const [activeReport, setActiveReport] = useState<Report>("cataloguing")
  const [isConnected, setConnected]     = useState<boolean | null>(null)
  const [bcError, setBcError]           = useState<string | null>(null)
  const [debugReason, setDebugReason]   = useState<string | null>(null)
  const [refreshKey, setRefreshKey]     = useState(0)
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null)

  useEffect(() => {
    fetch("/api/user/section-access/BC_REPORTS")
      .then(r => r.json())
      .then(({ allowed }: { allowed: string[] | null }) => {
        setAllowedSections(allowed)
        if (allowed && !allowed.includes(activeReport)) {
          setActiveReport((allowed[0] as Report) ?? "cataloguing")
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          <Logo variant="compact" />
          <p className="text-gray-600 text-xs mt-1">BC Reports</p>
        </div>

        {/* Reports nav */}
        <div className="flex-1 px-3 py-4">
          <p className="text-gray-600 text-xs uppercase tracking-wider mb-2 px-1">Reports</p>
          <div className="space-y-0.5">
            {reports.filter(r => !allowedSections || allowedSections.includes(r.id)).map((r) => (
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
            {activeReport === "explorer"    && <DataExplorerTab />}
            {activeReport === "location"    && <LocationHistoryTab />}
          </div>
        )}
      </main>
    </div>
  )
}
