"use client"

import { useState, useEffect, useCallback, useRef } from "react"

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

type HeatLocation = { code: string; name: string; total: number; known: boolean; cataloguingBench: boolean }
type HeatData = {
  locations: HeatLocation[]
  unlocated: number
  meta: { total: number; knownLocations: number; unknownLocations: number; occupiedLocations: number; emptyLocations: number }
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
  const [items, setItems] = useState(0)
  const [batch, setBatch] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  async function runSync() {
    abortRef.current = false
    setPhase("running")
    setError(null)
    setItems(0)
    setBatch(0)

    // Step 1: receipt lines — call repeatedly until more === false
    // Each call handles 5 pages × 500 = 2,500 items (safe under Railway's 60s limit)
    let more = true
    while (more && !abortRef.current) {
      try {
        const res = await fetch("/api/warehouse/sync/receipt-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxPages: 5 }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "receipt-lines failed")
        setItems(i => i + (data.itemsProcessed ?? 0))
        setBatch(b => b + 1)
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
            <span>Syncing… {items.toLocaleString()} items ({batch} batches done)</span>
          </div>
          <p className="text-xs text-gray-500">Do not close this tab — this may take a few minutes</p>
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

// Traffic-light colours by item count
function fillColor(total: number): { bg: string; ring: string; text: string } {
  if (total === 0)  return { bg: "bg-gray-900",   ring: "ring-gray-800",   text: "text-gray-600" }
  if (total <= 2)   return { bg: "bg-emerald-700/70", ring: "ring-emerald-500/40", text: "text-emerald-100" }
  if (total <= 5)   return { bg: "bg-yellow-600/70", ring: "ring-yellow-400/40", text: "text-yellow-50" }
  if (total <= 9)   return { bg: "bg-orange-600/80", ring: "ring-orange-400/50", text: "text-orange-50" }
  return                  { bg: "bg-red-700",        ring: "ring-red-500/60",   text: "text-red-50" }
}

// Group code "A10A1" → aisle "A10", bay "A", shelf "1"
function parseLocation(code: string): { aisle: string; bay: string; shelf: string } | null {
  const m = code.match(/^([A-Z]?\d+)([A-Z]+)(\d+)$/)
  if (!m) return null
  return { aisle: m[1], bay: m[2], shelf: m[3] }
}

function WarehouseHeatmapTab() {
  const [data, setData] = useState<HeatData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<SearchItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [aisleFilter, setAisleFilter] = useState<string>("ALL")
  const [showEmpty, setShowEmpty] = useState(true)

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

  // Group locations by aisle, then by bay
  type Group = Map<string /* bay */, HeatLocation[]>
  const aisles = new Map<string, Group>()
  const other:  HeatLocation[] = []

  for (const loc of data.locations) {
    const parsed = parseLocation(loc.code)
    if (!parsed) { other.push(loc); continue }
    if (!aisles.has(parsed.aisle)) aisles.set(parsed.aisle, new Map())
    const bayMap = aisles.get(parsed.aisle)!
    if (!bayMap.has(parsed.bay)) bayMap.set(parsed.bay, [])
    bayMap.get(parsed.bay)!.push(loc)
  }

  // Aisle list, sorted naturally (A1, A2, ..., A10, ...)
  const aisleNames = [...aisles.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  )

  // Filter aisles to display
  const visibleAisles = aisleFilter === "ALL"
    ? aisleNames
    : aisleNames.filter(a => a === aisleFilter)

  // Stats
  const occupied = data.meta.occupiedLocations
  const empty    = data.meta.emptyLocations

  return (
    <div className="flex h-full">
      {/* Heatmap panel */}
      <div className="flex-1 overflow-y-auto p-4 min-w-0">

        {/* Header bar */}
        <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-gray-800">
          <div className="text-sm">
            <span className="text-white font-semibold">{data.locations.length.toLocaleString()}</span>
            <span className="text-gray-500"> locations · </span>
            <span className="text-emerald-400 font-medium">{occupied.toLocaleString()}</span>
            <span className="text-gray-500"> occupied · </span>
            <span className="text-gray-500 font-medium">{empty.toLocaleString()} empty · </span>
            <span className="text-gray-300 font-medium">{data.meta.total.toLocaleString()}</span>
            <span className="text-gray-500"> items total</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Aisle filter */}
            <select
              value={aisleFilter}
              onChange={e => setAisleFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded text-xs px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All aisles ({aisleNames.length})</option>
              {aisleNames.map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={e => setShowEmpty(e.target.checked)}
                className="accent-blue-500"
              />
              Show empty
            </label>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mb-4 text-xs text-gray-400">
          <span className="text-gray-500 uppercase tracking-wider">Fill level:</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-900 ring-1 ring-gray-800" /> Empty</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-700/70" /> 1–2</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-600/70" /> 3–5</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-600/80" /> 6–9</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-700" /> 10+</span>
        </div>

        {/* Unlocated chip */}
        {data.unlocated > 0 && (
          <button
            onClick={() => selectLocation("")}
            className={`mb-4 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              selected === "" ? "bg-blue-700 border-blue-500 text-white" : "bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500"
            }`}
          >
            ⚠ Unlocated · {data.unlocated.toLocaleString()} items
          </button>
        )}

        {/* Aisles */}
        <div className="space-y-5">
          {visibleAisles.map(aisle => {
            const bays = aisles.get(aisle)!
            const bayNames = [...bays.keys()].sort()
            const totalInAisle = [...bays.values()].flat().reduce((s, l) => s + l.total, 0)
            const filledInAisle = [...bays.values()].flat().filter(l => l.total > 0).length
            const totalCells = [...bays.values()].flat().length

            return (
              <div key={aisle} className="bg-gray-900/40 rounded-lg border border-gray-800 p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white font-mono">{aisle}</h3>
                  <span className="text-xs text-gray-500">
                    {filledInAisle}/{totalCells} shelves · {totalInAisle} items
                  </span>
                </div>

                {/* Bays grid */}
                <div className="space-y-1.5">
                  {bayNames.map(bay => {
                    const shelves = bays.get(bay)!.sort((a, b) => {
                      const na = parseInt(parseLocation(a.code)?.shelf ?? "0", 10)
                      const nb = parseInt(parseLocation(b.code)?.shelf ?? "0", 10)
                      return na - nb
                    })
                    return (
                      <div key={bay} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-500 w-6 flex-shrink-0">{bay}</span>
                        <div className="flex flex-wrap gap-1">
                          {shelves.map(loc => {
                            if (!showEmpty && loc.total === 0) return null
                            const c = fillColor(loc.total)
                            const isSel = selected === loc.code
                            const shelfNum = parseLocation(loc.code)?.shelf ?? loc.code
                            return (
                              <button
                                key={loc.code}
                                onClick={() => selectLocation(loc.code)}
                                title={`${loc.code} — ${loc.total} item${loc.total === 1 ? "" : "s"}`}
                                className={`w-9 h-9 rounded text-xs font-mono font-semibold flex flex-col items-center justify-center transition-all ${c.bg} ${c.text} ring-1 ${c.ring} hover:brightness-125 hover:scale-110 ${
                                  isSel ? "ring-2 ring-blue-400 scale-110" : ""
                                }`}
                              >
                                <span className="leading-none text-[10px] opacity-70">{shelfNum}</span>
                                <span className="leading-none text-[11px]">{loc.total || ""}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Other (codes not matching aisle/bay/shelf pattern) */}
          {aisleFilter === "ALL" && other.length > 0 && (
            <div className="bg-gray-900/40 rounded-lg border border-gray-800 p-3">
              <h3 className="text-sm font-semibold text-white mb-2">Other locations</h3>
              <div className="flex flex-wrap gap-1.5">
                {other.filter(l => showEmpty || l.total > 0).map(loc => {
                  const c = fillColor(loc.total)
                  const isSel = selected === loc.code
                  return (
                    <button
                      key={loc.code}
                      onClick={() => selectLocation(loc.code)}
                      title={`${loc.code} — ${loc.total} items`}
                      className={`px-2.5 py-1.5 rounded text-xs font-mono ${c.bg} ${c.text} ring-1 ${c.ring} hover:brightness-125 ${
                        isSel ? "ring-2 ring-blue-400" : ""
                      }`}
                    >
                      {loc.code} <span className="opacity-60">{loc.total}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Items panel */}
      <div className="w-96 flex-shrink-0 border-l border-gray-800 overflow-y-auto p-4 bg-gray-950">
        {!selected && selected !== "" ? (
          <div className="text-gray-500 text-sm mt-8 text-center">Click a shelf to see its items</div>
        ) : itemsLoading ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-gray-500 text-sm">No items found</div>
        ) : (
          <div className="space-y-2">
            <div className="mb-3 pb-2 border-b border-gray-800">
              <div className="font-mono text-base text-blue-400 font-semibold">{selected || "Unlocated"}</div>
              <div className="text-xs text-gray-500">{items.length} item{items.length === 1 ? "" : "s"}</div>
            </div>
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

// ─── LocationHistoryTab ───────────────────────────────────────────────────────

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
            placeholder={mode === "tote" ? "e.g. T000123" : "e.g. F037458"} autoFocus
            className="flex-1 bg-[#07070f] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono" />
          <button onClick={lookup} disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
            {loading ? "Searching…" : "Look up"}
          </button>
        </div>
        {mode === "barcode" && <p className="text-xs text-gray-600">Barcode lookup does two BC queries: first finds the item key from the barcode, then fetches all location changes for that item.</p>}
      </div>

      {error && <div className="mt-4 max-w-lg"><p className="text-red-400 text-sm">{error}</p></div>}

      {result && (
        <div className="mt-5 max-w-2xl space-y-4">
          <div className="flex items-center gap-8">
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
              <p className="text-gray-400 text-sm">No location changes found in the BC change log.</p>
              <p className="text-gray-600 text-xs mt-1">The item may not have been moved, or the change log wasn't active when it was.</p>
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
      // Loop receipt-lines until more === false (each call handles 5 pages × 500 = 2,500 items)
      let more = true
      let safety = 0
      while (more && safety < 200) {
        const res = await fetch("/api/warehouse/sync/receipt-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxPages: 5 }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) break
        more = data.more === true
        safety++
        // Refresh status periodically so the user sees the count climb
        if (safety % 4 === 0) await fetchStatus()
      }
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
    <div className="flex flex-col h-full bg-gray-950 text-white">
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
