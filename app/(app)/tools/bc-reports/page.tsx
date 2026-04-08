"use client"

import { useState, useCallback } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LabelList, ResponsiveContainer, Cell,
} from "recharts"
import * as XLSX from "xlsx"

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split("T")[0]
}
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}
function startOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0]
}
function startOfYear() {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0]
}
function lastMonthRange(): [string, string] {
  const d   = new Date()
  const end = new Date(d.getFullYear(), d.getMonth(), 0)
  const start = new Date(end.getFullYear(), end.getMonth(), 1)
  return [start.toISOString().split("T")[0], end.toISOString().split("T")[0]]
}

function exportXlsx(rows: object[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Report")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ─── Bar chart component ──────────────────────────────────────────────────────

function HBar({ data, valueKey, labelKey }: {
  data: object[]
  valueKey: string
  labelKey: string
}) {
  if (!data.length) return <p className="text-gray-400 text-sm py-4">No data</p>
  const barHeight = Math.max(36, Math.min(56, 600 / data.length))
  const chartH    = data.length * barHeight + 40

  return (
    <ResponsiveContainer width="100%" height={chartH}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 160, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
        <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey={labelKey}
          width={155}
          tick={{ fontSize: 13 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "#f3f4f6" }}
          contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #e5e7eb" }}
        />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={40}>
          {data.map((_, i) => (
            <Cell key={i} fill="#0078D4" />
          ))}
          <LabelList dataKey={valueKey} position="right" style={{ fontSize: 12, fill: "#374151" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Date presets + range picker ─────────────────────────────────────────────

function DateRange({ from, to, onChange }: {
  from: string; to: string
  onChange: (from: string, to: string) => void
}) {
  const presets = [
    { label: "Last 7 days",  from: daysAgo(6),         to: today() },
    { label: "Last 30 days", from: daysAgo(29),         to: today() },
    { label: "This month",   from: startOfMonth(),       to: today() },
    { label: "Last month",   from: lastMonthRange()[0],  to: lastMonthRange()[1] },
    { label: "This year",    from: startOfYear(),         to: today() },
  ]
  return (
    <div className="space-y-3 mb-5">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.from, p.to)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              from === p.from && to === p.to
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => onChange(e.target.value, to)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => onChange(from, e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Meta badge ───────────────────────────────────────────────────────────────

function Meta({ items }: { items: { label: string; value: string | number }[] }) {
  return (
    <div className="flex flex-wrap gap-4 mb-4">
      {items.map((m) => (
        <div key={m.label} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-center">
          <p className="text-xl font-bold text-gray-800">{m.value.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-0.5">{m.label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Sub-tabs ────────────────────────────────────────────────────────────────

function SubTabs({ tabs, active, onChange }: {
  tabs: string[]; active: string; onChange: (t: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            active === t ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-800"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

// ─── Fetch with loading state ─────────────────────────────────────────────────

function useReport<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetcher())
    } catch (e: any) {
      setError(e.message ?? "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [fetcher])

  return { data, loading, error, load }
}

// ─── Cataloguing tab ──────────────────────────────────────────────────────────

function CataloguingTab() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to,   setTo]   = useState(today())
  const [data, setData] = useState<CatData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [subTab, setSubTab]   = useState("Daily Average")

  async function fetch() {
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch(`/api/bc/cataloguing?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
      <button
        onClick={fetch}
        disabled={loading}
        className="mb-5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
      >
        {loading ? "Loading…" : "Load Report"}
      </button>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {data && (
        <>
          <Meta items={[
            { label: "Total entries", value: data.meta.total },
            { label: "Active users",  value: data.meta.userCount },
          ]} />
          <SubTabs
            tabs={["Daily Average", "Total Lots", "By Month"]}
            active={subTab}
            onChange={setSubTab}
          />
          {subTab === "Daily Average" && (
            <>
              <HBar data={data.dailyAvg} valueKey="avg" labelKey="user" />
              <button
                onClick={() => exportXlsx(data.dailyAvg, "cataloguing_daily_avg")}
                className="mt-3 text-xs text-blue-600 hover:underline"
              >
                Export to Excel
              </button>
            </>
          )}
          {subTab === "Total Lots" && (
            <>
              <HBar data={data.totalLots} valueKey="total" labelKey="user" />
              <button
                onClick={() => exportXlsx(data.totalLots, "cataloguing_total_lots")}
                className="mt-3 text-xs text-blue-600 hover:underline"
              >
                Export to Excel
              </button>
            </>
          )}
          {subTab === "By Month" && (
            <>
              <HBar data={data.monthly} valueKey="total" labelKey="label" />
              <button
                onClick={() => exportXlsx(data.monthly, "cataloguing_monthly")}
                className="mt-3 text-xs text-blue-600 hover:underline"
              >
                Export to Excel
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Packing tab ──────────────────────────────────────────────────────────────

function PackingTab() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to,   setTo]   = useState(today())
  const [data, setData] = useState<PackData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [subTab, setSubTab]   = useState("Collections Daily Avg")

  async function fetch() {
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch(`/api/bc/packing?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const subTabs = ["Collections Daily Avg", "Collections Total", "Lots Daily Avg", "Total Lots", "Raw Data"]

  return (
    <div>
      <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
      <button
        onClick={fetch}
        disabled={loading}
        className="mb-5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
      >
        {loading ? "Loading…" : "Load Report"}
      </button>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {data && (
        <>
          <Meta items={[
            { label: "Shipments", value: data.meta.total },
            { label: "Staff",     value: data.meta.staffCount },
          ]} />
          <SubTabs tabs={subTabs} active={subTab} onChange={setSubTab} />

          {subTab === "Collections Daily Avg" && (
            <>
              <HBar data={data.dailyAvgCollections} valueKey="avg" labelKey="staff" />
              <button onClick={() => exportXlsx(data.dailyAvgCollections, "packing_daily_avg")} className="mt-3 text-xs text-blue-600 hover:underline">Export to Excel</button>
            </>
          )}
          {subTab === "Collections Total" && (
            <>
              <HBar data={data.totalCollections} valueKey="total" labelKey="staff" />
              <button onClick={() => exportXlsx(data.totalCollections, "packing_collections_total")} className="mt-3 text-xs text-blue-600 hover:underline">Export to Excel</button>
            </>
          )}
          {subTab === "Lots Daily Avg" && (
            <>
              <HBar data={data.dailyAvgLots} valueKey="avg" labelKey="staff" />
              <button onClick={() => exportXlsx(data.dailyAvgLots, "packing_lots_daily_avg")} className="mt-3 text-xs text-blue-600 hover:underline">Export to Excel</button>
            </>
          )}
          {subTab === "Total Lots" && (
            <>
              <HBar data={data.totalLots} valueKey="total" labelKey="staff" />
              <button onClick={() => exportXlsx(data.totalLots, "packing_total_lots")} className="mt-3 text-xs text-blue-600 hover:underline">Export to Excel</button>
            </>
          )}
          {subTab === "Raw Data" && (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Staff</th>
                      <th className="px-4 py-2 text-left">Document No</th>
                      <th className="px-4 py-2 text-right">Lot Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.raw.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2">{r.date}</td>
                        <td className="px-4 py-2">{r.staff}</td>
                        <td className="px-4 py-2 text-gray-500">{r.docNo}</td>
                        <td className="px-4 py-2 text-right">{r.lotCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={() => exportXlsx(data.raw, "packing_raw")} className="mt-3 text-xs text-blue-600 hover:underline">Export to Excel</button>
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

  async function fetch() {
    setLoading(true); setError(null)
    try {
      const res  = await window.fetch("/api/bc/warehouse")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={fetch}
        disabled={loading}
        className="mb-5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
      >
        {loading ? "Loading…" : "Load Snapshot"}
      </button>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {data && (
        <>
          <Meta items={[
            { label: "Total totes",   value: data.meta.total },
            { label: "Open totes",    value: data.meta.openTotes },
          ]} />
          <SubTabs
            tabs={["By Category", "By Cataloguer"]}
            active={subTab}
            onChange={setSubTab}
          />
          {subTab === "By Category" && (
            <>
              <HBar data={data.byCategory} valueKey="count" labelKey="category" />
              <button onClick={() => exportXlsx(data.byCategory, "warehouse_by_category")} className="mt-3 text-xs text-blue-600 hover:underline">Export to Excel</button>
            </>
          )}
          {subTab === "By Cataloguer" && (
            <>
              <HBar data={data.byCataloguer} valueKey="count" labelKey="cataloguer" />
              <button onClick={() => exportXlsx(data.byCataloguer, "warehouse_by_cataloguer")} className="mt-3 text-xs text-blue-600 hover:underline">Export to Excel</button>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = ["Cataloguing", "Packing", "Warehouse"]

export default function BCReportsPage() {
  const [tab, setTab] = useState("Cataloguing")

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">BC Reports</h1>
      <p className="text-sm text-gray-500 mb-6">Business Central reporting dashboard</p>

      {/* Main tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Cataloguing" && <CataloguingTab />}
      {tab === "Packing"     && <PackingTab />}
      {tab === "Warehouse"   && <WarehouseTab />}
    </div>
  )
}
