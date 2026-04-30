"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Logo from "@/components/logo"

// ─── Types ────────────────────────────────────────────────────────────────────

type SyncStatus = {
  itemCount: number
  running: string[]
  sources: {
    receipt_lines: { completedAt: string; itemsProcessed: number } | null
    auction_lines:  { completedAt: string; itemsProcessed: number } | null
    changelog:      { completedAt: string; itemsProcessed: number } | null
  }
}

type HeatLocation = { code: string; total: number }
type HeatData = {
  locations: HeatLocation[]
  unlocated: number
  meta: { total: number }
}

type SaleItem = {
  uniqueId: string
  lotNo: string | null
  currentLotNo: string | null
  description: string | null
  artist: string | null
  location: string | null
  binCode: string | null
  toteNo: string | null
  vendorNo: string | null
  vendorName: string | null
  withdrawLot: boolean | null
  collected: boolean | null
}

type SaleAuction = {
  code: string
  date: string | null
  items: SaleItem[]
}

type SaleData = {
  auctions: SaleAuction[]
  total: number
}

type SearchItem = {
  uniqueId: string
  description: string | null
  artist: string | null
  location: string | null
  binCode: string | null
  toteNo: string | null
  auctionCode: string | null
  lotNo: string | null
  category: string | null
}

type Tab = "heatmap" | "sale-checklist" | "search" | "location-history" | "tote-data"

const STALE_MS = 15 * 60 * 1000 // 15 minutes

function isStale(completedAt: string | undefined | null): boolean {
  if (!completedAt) return true
  return Date.now() - new Date(completedAt).getTime() > STALE_MS
}

// ─── SyncBar ──────────────────────────────────────────────────────────────────

function SyncBar({ status, onSync }: { status: SyncStatus | null; onSync: () => void }) {
  const last = status?.sources.receipt_lines?.completedAt
  const running = (status?.running ?? []).length > 0

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-t border-gray-700 text-xs text-gray-400">
      <span>{status?.itemCount ?? 0} items in DB</span>
      {last && (
        <span>· Last sync {new Date(last).toLocaleTimeString()}</span>
      )}
      {running && <span className="text-yellow-400 animate-pulse">· Syncing…</span>}
      <button
        onClick={onSync}
        disabled={running}
        className="ml-auto text-blue-400 hover:text-blue-300 disabled:opacity-40"
      >
        Sync now
      </button>
    </div>
  )
}

// ─── FirstSyncPanel ───────────────────────────────────────────────────────────

function FirstSyncPanel({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle")
  const [pages, setPages] = useState(0)
  const [items, setItems] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  async function runSync() {
    abortRef.current = false
    setPhase("running")
    setError(null)

    // Step 1: receipt lines (may need multiple calls)
    let more = true
    while (more && !abortRef.current) {
      try {
        const res = await fetch("/api/warehouse/sync/receipt-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxPages: 50 }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "receipt-lines failed")
        setItems(i => i + (data.itemsProcessed ?? 0))
        setPages(p => p + 50)
        more = data.more === true
      } catch (e: any) {
        setError(e.message)
        setPhase("error")
        return
      }
    }

    // Step 2: auction lines
    if (!abortRef.current) {
      try {
        const res = await fetch("/api/warehouse/sync/auction-lines", { method: "POST" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "auction-lines failed")
        setItems(i => i + (data.itemsProcessed ?? 0))
      } catch (e: any) {
        setError(e.message)
        setPhase("error")
        return
      }
    }

    // Step 3: changelog
    if (!abortRef.current) {
      try {
        const res = await fetch("/api/warehouse/sync/changelog", { method: "POST" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "changelog failed")
      } catch { /* changelog failure is non-fatal */ }
    }

    setPhase("done")
    onComplete()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-8">
      <div className="text-4xl">📦</div>
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">No warehouse data yet</h2>
        <p className="text-gray-400 text-sm max-w-sm">
          The first sync downloads all items from Business Central and stores them locally.
          This takes a few minutes — subsequent syncs are instant.
        </p>
      </div>

      {phase === "idle" && (
        <button
          onClick={runSync}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium"
        >
          Start initial sync
        </button>
      )}

      {phase === "running" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-yellow-400">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            <span>Syncing… {items.toLocaleString()} items so far</span>
          </div>
          <p className="text-xs text-gray-500">Do not close this tab</p>
          <button
            onClick={() => { abortRef.current = true; setPhase("error"); setError("Cancelled") }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === "done" && (
        <p className="text-green-400 font-medium">✓ Sync complete — {items.toLocaleString()} items loaded</p>
      )}

      {phase === "error" && (
        <div className="space-y-2">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={runSync}
            className="px-4 py-2 bg-red-900 hover:bg-red-800 text-white rounded text-sm"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

// ─── WarehouseHeatmapTab ──────────────────────────────────────────────────────

function WarehouseHeatmapTab() {
  const [data, setData] = useState<HeatData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<SearchItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)

  useEffect(() => {
    fetch("/api/warehouse/heatmap")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function selectLocation(code: string) {
    setSelected(code)
    setItemsLoading(true)
    try {
      const r = await fetch(`/api/warehouse/search?location=${encodeURIComponent(code)}`)
      const d = await r.json()
      setItems(d.items ?? [])
    } catch { setItems([]) }
    setItemsLoading(false)
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading heatmap…</div>
  if (!data) return <div className="p-6 text-red-400 text-sm">Failed to load heatmap</div>

  const max = Math.max(...data.locations.map(l => l.total), 1)

  return (
    <div className="flex h-full">
      {/* Location grid */}
      <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-gray-700 p-3">
        <div className="text-xs text-gray-500 mb-2 px-1">
          {data.locations.length} locations · {data.meta.total} items
        </div>
        {data.unlocated > 0 && (
          <button
            onClick={() => selectLocation("")}
            className={`w-full text-left px-3 py-2 rounded mb-1 text-sm flex justify-between items-center ${
              selected === "" ? "bg-blue-700 text-white" : "bg-gray-800 hover:bg-gray-700 text-gray-300"
            }`}
          >
            <span className="italic text-gray-400">Unlocated</span>
            <span className="font-mono text-xs">{data.unlocated}</span>
          </button>
        )}
        {data.locations.map(loc => {
          const heat = loc.total / max
          const bg = heat > 0.75 ? "bg-red-900" : heat > 0.5 ? "bg-orange-900" : heat > 0.25 ? "bg-yellow-900" : "bg-gray-800"
          return (
            <button
              key={loc.code}
              onClick={() => selectLocation(loc.code)}
              className={`w-full text-left px-3 py-2 rounded mb-1 text-sm flex justify-between items-center ${
                selected === loc.code ? "bg-blue-700 text-white" : `${bg} hover:brightness-125 text-gray-200`
              }`}
            >
              <span className="font-mono">{loc.code}</span>
              <span className="text-xs opacity-70">{loc.total}</span>
            </button>
          )
        })}
      </div>

      {/* Items panel */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selected && selected !== "" ? (
          <div className="text-gray-500 text-sm mt-8 text-center">Select a location to see items</div>
        ) : itemsLoading ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-gray-500 text-sm">No items found</div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-gray-500 mb-3">{items.length} items in {selected || "unlocated"}</div>
            {items.map(item => (
              <div key={item.uniqueId} className="bg-gray-800 rounded-lg px-4 py-3 text-sm">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <span className="font-mono text-xs text-gray-400">{item.uniqueId}</span>
                    {item.auctionCode && (
                      <span className="ml-2 text-xs bg-blue-900 text-blue-200 px-2 py-0.5 rounded">{item.auctionCode}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 text-right shrink-0">
                    {[item.location, item.binCode, item.toteNo].filter(Boolean).join(" / ")}
                  </div>
                </div>
                {(item.description || item.artist) && (
                  <div className="mt-1 text-gray-200 text-xs">
                    {item.artist ? <span className="text-yellow-400">{item.artist} — </span> : null}
                    {item.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SaleChecklistTab ─────────────────────────────────────────────────────────

function SaleChecklistTab() {
  const [data, setData] = useState<SaleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "located" | "missing">("all")
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/warehouse/sale-checklist")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading sale checklist…</div>
  if (!data) return <div className="p-6 text-red-400 text-sm">Failed to load sale checklist</div>

  const auctions = data.auctions.filter(a =>
    !search || a.code.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-3 p-3 border-b border-gray-700 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search auction code…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {(["all", "located", "missing"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-sm ${filter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            {f === "all" ? "All" : f === "located" ? "Located" : "Missing"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {auctions.length === 0 && (
          <div className="text-gray-500 text-sm text-center mt-8">No auctions found</div>
        )}
        {auctions.map(auction => {
          const items = filter === "all" ? auction.items
            : filter === "located" ? auction.items.filter(i => i.location)
            : auction.items.filter(i => !i.location)

          if (items.length === 0 && filter !== "all") return null

          const isOpen = expanded === auction.code
          const located = auction.items.filter(i => i.location).length
          const missing = auction.items.length - located

          return (
            <div key={auction.code} className="bg-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : auction.code)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-white">{auction.code}</span>
                  {auction.date && (
                    <span className="text-xs text-gray-400">{new Date(auction.date).toLocaleDateString()}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-400">{located} located</span>
                  {missing > 0 && <span className="text-red-400">{missing} missing</span>}
                  <span className="text-gray-500">{auction.items.length} total</span>
                  <span className="text-gray-500">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-gray-700">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-900 text-gray-400">
                      <tr>
                        <th className="px-3 py-2 text-left">Unique ID</th>
                        <th className="px-3 py-2 text-left">Lot</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-left">Location</th>
                        <th className="px-3 py-2 text-left">Vendor</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {items.map(item => (
                        <tr key={item.uniqueId} className={!item.location ? "bg-red-950/30" : ""}>
                          <td className="px-3 py-2 font-mono text-gray-300">{item.uniqueId}</td>
                          <td className="px-3 py-2 text-gray-300">{item.currentLotNo ?? item.lotNo ?? "—"}</td>
                          <td className="px-3 py-2 text-gray-200 max-w-xs truncate">
                            {item.artist ? <span className="text-yellow-400">{item.artist} — </span> : null}
                            {item.description ?? "—"}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {item.location ? (
                              <span className="text-green-400">{[item.location, item.binCode, item.toteNo].filter(Boolean).join("·")}</span>
                            ) : (
                              <span className="text-red-400">Missing</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-400">{item.vendorName ?? item.vendorNo ?? "—"}</td>
                          <td className="px-3 py-2">
                            {item.withdrawLot && <span className="text-orange-400">Withdraw</span>}
                            {item.collected && <span className="text-blue-400">Collected</span>}
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
    </div>
  )
}

// ─── SearchByLocationTab ──────────────────────────────────────────────────────

function SearchByLocationTab() {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<SearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function doSearch(e?: React.FormEvent) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const r = await fetch(`/api/warehouse/search?location=${encodeURIComponent(query.trim())}`)
      const d = await r.json()
      setItems(d.items ?? [])
    } catch { setItems([]) }
    setLoading(false)
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <form onSubmit={doSearch} className="flex gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Location code e.g. A21…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-sm"
        >
          Search
        </button>
      </form>

      {loading && <div className="text-gray-400 text-sm">Searching…</div>}
      {!loading && searched && items.length === 0 && (
        <div className="text-gray-500 text-sm">No items found for "{query}"</div>
      )}
      {!loading && items.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-2">
          <div className="text-xs text-gray-500">{items.length} items</div>
          {items.map(item => (
            <div key={item.uniqueId} className="bg-gray-800 rounded-lg px-4 py-3 text-sm">
              <div className="flex justify-between items-start">
                <div className="flex gap-2 items-center">
                  <span className="font-mono text-xs text-gray-400">{item.uniqueId}</span>
                  {item.auctionCode && (
                    <span className="text-xs bg-blue-900 text-blue-200 px-2 py-0.5 rounded">{item.auctionCode}</span>
                  )}
                  {item.category && (
                    <span className="text-xs text-gray-500">{item.category}</span>
                  )}
                </div>
                <span className="text-xs font-mono text-gray-500">
                  {[item.location, item.binCode, item.toteNo].filter(Boolean).join(" / ")}
                </span>
              </div>
              {(item.description || item.artist) && (
                <div className="mt-1 text-xs text-gray-300">
                  {item.artist ? <span className="text-yellow-400">{item.artist} — </span> : null}
                  {item.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── LocationHistoryTab (unchanged — still uses BC directly) ──────────────────

function LocationHistoryTab() {
  const [uniqueId, setUniqueId] = useState("")
  const [rows, setRows]         = useState<any[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    if (!uniqueId.trim()) return
    setLoading(true); setError(null); setRows([])
    try {
      const r = await fetch(`/api/warehouse/location-history?uniqueId=${encodeURIComponent(uniqueId.trim())}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? "Failed")
      setRows(d.rows ?? [])
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <form onSubmit={lookup} className="flex gap-2">
        <input
          value={uniqueId}
          onChange={e => setUniqueId(e.target.value)}
          placeholder="Unique ID e.g. R000006-1…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-sm"
        >
          Look up
        </button>
      </form>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {rows.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-900 text-gray-400 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Date/Time</th>
                <th className="px-3 py-2 text-left">Old Value</th>
                <th className="px-3 py-2 text-left">New Value</th>
                <th className="px-3 py-2 text-left">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {rows.map((r, i) => (
                <tr key={i} className="text-gray-300">
                  <td className="px-3 py-2">{r.Date_and_Time ? new Date(r.Date_and_Time).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 font-mono">{r.Old_Value ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">{r.New_Value ?? "—"}</td>
                  <td className="px-3 py-2">{r.User_ID ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── ToteDataTab (unchanged — still uses BC directly) ─────────────────────────

function ToteDataTab() {
  const [toteNo, setToteNo]   = useState("")
  const [rows, setRows]       = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    if (!toteNo.trim()) return
    setLoading(true); setError(null); setRows([])
    try {
      const r = await fetch(`/api/warehouse/tote?toteNo=${encodeURIComponent(toteNo.trim())}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? "Failed")
      setRows(d.rows ?? [])
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <form onSubmit={lookup} className="flex gap-2">
        <input
          value={toteNo}
          onChange={e => setToteNo(e.target.value)}
          placeholder="Tote number…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-sm"
        >
          Look up
        </button>
      </form>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {rows.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-2">
          <div className="text-xs text-gray-500">{rows.length} items in tote {toteNo}</div>
          {rows.map((r: any, i: number) => (
            <div key={i} className="bg-gray-800 rounded-lg px-4 py-3 text-sm">
              <div className="flex justify-between items-start">
                <span className="font-mono text-xs text-gray-400">{r.uniqueId ?? "—"}</span>
                <span className="text-xs font-mono text-gray-500">{[r.location, r.binCode, r.toteNo].filter(Boolean).join(" / ") || "—"}</span>
              </div>
              {(r.artist || r.description) && (
                <div className="mt-1 text-xs text-gray-300">
                  {r.artist ? <span className="text-yellow-400">{r.artist} — </span> : null}
                  {r.description}
                </div>
              )}
              {r.auctionCode && (
                <span className="text-xs bg-blue-900 text-blue-200 px-2 py-0.5 rounded mt-1 inline-block">{r.auctionCode}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BCWarehousePage() {
  const [tab, setTab] = useState<Tab>("heatmap")
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [showFirstSync, setShowFirstSync] = useState(false)
  const syncingRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/warehouse/sync/status")
      const d: SyncStatus = await r.json()
      setStatus(d)
      setShowFirstSync(d.itemCount === 0)
      return d
    } catch { return null }
  }, [])

  async function triggerIncrementalSync() {
    if (syncingRef.current) return
    syncingRef.current = true
    try {
      await fetch("/api/warehouse/sync/receipt-lines", { method: "POST" })
      await fetch("/api/warehouse/sync/auction-lines", { method: "POST" })
      await fetch("/api/warehouse/sync/changelog", { method: "POST" })
      await fetchStatus()
    } finally {
      syncingRef.current = false
    }
  }

  useEffect(() => {
    fetchStatus().then(s => {
      if (!s) return
      if (s.itemCount === 0) return // let FirstSyncPanel handle it
      // Auto-sync if stale
      if (isStale(s.sources.receipt_lines?.completedAt)) {
        triggerIncrementalSync()
      }
    })
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: "heatmap",          label: "Location Heatmap" },
    { id: "sale-checklist",   label: "Sale Checklist" },
    { id: "search",           label: "Search by Location" },
    { id: "location-history", label: "Location History" },
    { id: "tote-data",        label: "Tote Data" },
  ]

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 shrink-0">
        <Logo className="h-6 w-auto opacity-80" />
        <span className="text-sm font-medium text-gray-300">BC Warehouse</span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-3 border-b border-gray-800 shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm rounded-t transition-colors ${
              tab === t.id
                ? "bg-gray-800 text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {showFirstSync ? (
          <FirstSyncPanel onComplete={() => { setShowFirstSync(false); fetchStatus() }} />
        ) : (
          <>
            {tab === "heatmap"          && <WarehouseHeatmapTab />}
            {tab === "sale-checklist"   && <SaleChecklistTab />}
            {tab === "search"           && <SearchByLocationTab />}
            {tab === "location-history" && <LocationHistoryTab />}
            {tab === "tote-data"        && <ToteDataTab />}
          </>
        )}
      </div>

      {/* Sync bar */}
      {!showFirstSync && (
        <SyncBar
          status={status}
          onSync={() => { triggerIncrementalSync(); fetchStatus() }}
        />
      )}
    </div>
  )
}
