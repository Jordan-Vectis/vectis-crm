import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { format } from "date-fns"
import Link from "next/link"

export const dynamic = "force-dynamic"

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

// Rough percentage bar
function PctBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: colour }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{Math.round(pct)}%</span>
    </div>
  )
}

export default async function CataloguingUserReportPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const { userId } = await params

  const logs = await prisma.catalogueTimingLog.findMany({
    where:   { userId },
    orderBy: { savedAt: "desc" },
    include: { auction: { select: { name: true, code: true } } },
  })

  if (logs.length === 0) notFound()

  const userName = logs[0].userName

  // ── Split by method ──
  const wizardLogs    = logs.filter(l => l.method === "WIZARD")
  const photoOnlyLogs = logs.filter(l => l.method === "PHOTO_ONLY")

  // ── Overall ──
  const allDurations = logs.map(l => l.durationMs)
  const overallAvg   = avg(allDurations)
  const fastest      = Math.min(...allDurations)
  const slowest      = Math.max(...allDurations)

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const lotsToday  = logs.filter(l => l.savedAt >= todayStart).length

  // ── Key points (wizard only) ──
  const kpLogs  = wizardLogs.filter(l => l.keyPointsMs && l.keyPointsMs > 0)
  const kpAvg   = kpLogs.length ? avg(kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpFast  = kpLogs.length ? Math.min(...kpLogs.map(l => l.keyPointsMs!)) : 0
  const kpSlow  = kpLogs.length ? Math.max(...kpLogs.map(l => l.keyPointsMs!)) : 0

  // Key points as % of total wizard time
  const kpPct = overallAvg > 0 && kpAvg > 0 ? Math.round((kpAvg / avg(wizardLogs.map(l => l.durationMs))) * 100) : 0

  // ── Lots this week ──
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0,0,0,0)
  const lotsThisWeek = logs.filter(l => l.savedAt >= weekStart).length

  // ── Per-auction ──
  const auctionMap = new Map<string, { name: string; code: string; count: number; durations: number[] }>()
  for (const log of logs) {
    if (!auctionMap.has(log.auctionId)) {
      auctionMap.set(log.auctionId, { name: log.auction.name, code: log.auction.code, count: 0, durations: [] })
    }
    const e = auctionMap.get(log.auctionId)!
    e.count++
    e.durations.push(log.durationMs)
  }
  const auctionStats = [...auctionMap.values()]
    .map(a => ({ ...a, avgMs: avg(a.durations) }))
    .sort((a, b) => b.count - a.count)

  return (
    <div className="p-8 max-w-5xl space-y-8">

      {/* Back + header */}
      <div>
        <Link href="/admin/cataloguing-reports"
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-4 transition-colors">
          ← Back to All Cataloguers
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{userName}</h1>
        <p className="text-sm text-gray-500 mt-1">Individual cataloguing performance report</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Lots",     value: logs.length.toLocaleString(),   sub: "all time" },
          { label: "Avg Time / Lot", value: fmtDuration(overallAvg),        sub: "all methods" },
          { label: "Lots Today",     value: lotsToday.toLocaleString(),      sub: format(new Date(), "d MMM yyyy") },
          { label: "This Week",      value: lotsThisWeek.toLocaleString(),   sub: "last 7 days" },
        ].map(card => (
          <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{card.label}</p>
            <p className="text-3xl font-bold text-slate-800">{card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Method breakdown + speed stats */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Method split */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Method Breakdown</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm font-semibold text-blue-600">Wizard</span>
                <span className="text-sm font-bold text-gray-700">{wizardLogs.length} lots</span>
              </div>
              <PctBar pct={logs.length ? (wizardLogs.length / logs.length) * 100 : 0} colour="#3b82f6" />
              <p className="text-xs text-gray-400 mt-1">Avg {fmtDuration(wizardLogs.length ? avg(wizardLogs.map(l => l.durationMs)) : 0)}</p>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm font-semibold text-purple-600">Photo Only</span>
                <span className="text-sm font-bold text-gray-700">{photoOnlyLogs.length} lots</span>
              </div>
              <PctBar pct={logs.length ? (photoOnlyLogs.length / logs.length) * 100 : 0} colour="#a855f7" />
              <p className="text-xs text-gray-400 mt-1">Avg {fmtDuration(photoOnlyLogs.length ? avg(photoOnlyLogs.map(l => l.durationMs)) : 0)}</p>
            </div>
          </div>
        </div>

        {/* Speed stats */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Speed Stats</h2>
          <div className="space-y-3">
            {[
              { label: "Average",  value: fmtDuration(overallAvg), colour: "text-slate-700" },
              { label: "Fastest",  value: fmtDuration(fastest),     colour: "text-green-600" },
              { label: "Slowest",  value: fmtDuration(slowest),     colour: "text-red-500" },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center py-1 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-500">{row.label}</span>
                <span className={`font-mono font-bold text-sm ${row.colour}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key Points section */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
          Step 3 — Key Points (Wizard only, {kpLogs.length} of {wizardLogs.length} wizard lots tracked)
        </h2>
        {kpLogs.length === 0 ? (
          <p className="text-sm text-gray-400">No key points timing data yet — data is captured going forward.</p>
        ) : (
          <div className="grid sm:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-gray-400 mb-1">Average time on Key Points</p>
              <p className="text-2xl font-bold text-slate-700 font-mono">{fmtDuration(kpAvg)}</p>
              {kpPct > 0 && <p className="text-xs text-gray-400 mt-1">{kpPct}% of total wizard time</p>}
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Fastest Key Points</p>
              <p className="text-2xl font-bold text-green-600 font-mono">{fmtDuration(kpFast)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Slowest Key Points</p>
              <p className="text-2xl font-bold text-red-500 font-mono">{fmtDuration(kpSlow)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Per-auction */}
      {auctionStats.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">By Auction</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Auction</th>
                  <th className="text-right px-5 py-3">Lots</th>
                  <th className="text-right px-5 py-3">Avg Time</th>
                  <th className="text-right px-5 py-3">Fastest</th>
                  <th className="text-right px-5 py-3">Slowest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {auctionStats.map(a => (
                  <tr key={a.code} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <span className="font-mono font-semibold text-slate-700 mr-2">{a.code}</span>
                      <span className="text-gray-500">{a.name}</span>
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-gray-700">{a.count}</td>
                    <td className="px-5 py-3 text-right font-mono text-gray-600">{fmtDuration(a.avgMs)}</td>
                    <td className="px-5 py-3 text-right font-mono text-green-600">{fmtDuration(Math.min(...a.durations))}</td>
                    <td className="px-5 py-3 text-right font-mono text-red-500">{fmtDuration(Math.max(...a.durations))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All lots log */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">All Lots ({logs.length})</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3">Date / Time</th>
                <th className="text-left px-5 py-3">Auction</th>
                <th className="text-left px-5 py-3">Lot Barcode</th>
                <th className="text-left px-5 py-3">Method</th>
                <th className="text-right px-5 py-3">Key Points</th>
                <th className="text-right px-5 py-3">Total Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap font-mono">
                    {format(log.savedAt, "dd/MM/yyyy HH:mm:ss")}
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-600 text-xs">{log.auction.code}</td>
                  <td className="px-5 py-3 font-mono text-gray-500 text-xs">{log.lotNumber || "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                      log.method === "WIZARD"
                        ? "bg-blue-50 text-blue-600 border border-blue-100"
                        : "bg-purple-50 text-purple-600 border border-purple-100"
                    }`}>
                      {log.method === "WIZARD" ? "Wizard" : "Photo Only"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-500 text-xs">
                    {log.method === "WIZARD" ? fmtDuration(log.keyPointsMs) : "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-bold text-gray-700">
                    {fmtDuration(log.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
