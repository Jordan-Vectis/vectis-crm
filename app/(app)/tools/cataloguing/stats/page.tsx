import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { format } from "date-fns"

export const dynamic = "force-dynamic"

export const metadata = { title: "Cataloguing Stats" }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—"
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CataloguingStatsPage() {
  const session = await auth()
  if (!session || !["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/hub")

  // All logs, newest first
  const logs = await prisma.catalogueTimingLog.findMany({
    orderBy: { savedAt: "desc" },
    include: { auction: { select: { name: true, code: true } } },
  })

  if (logs.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p className="text-lg font-semibold mb-2">No cataloguing data yet</p>
        <p className="text-sm">Timing is recorded automatically once lots are added via the wizard or photo-only flow.</p>
      </div>
    )
  }

  // ── Overall stats ──
  const allDurations = logs.map(l => l.durationMs)
  const overallAvg   = avg(allDurations)
  const overallMin   = Math.min(...allDurations)
  const overallMax   = Math.max(...allDurations)

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const lotsToday  = logs.filter(l => l.savedAt >= todayStart).length

  // ── Per-user stats ──
  const userMap = new Map<string, {
    name: string
    wizardLogs:    typeof logs
    photoOnlyLogs: typeof logs
  }>()

  for (const log of logs) {
    if (!userMap.has(log.userId)) {
      userMap.set(log.userId, { name: log.userName, wizardLogs: [], photoOnlyLogs: [] })
    }
    const entry = userMap.get(log.userId)!
    if (log.method === "WIZARD") entry.wizardLogs.push(log)
    else entry.photoOnlyLogs.push(log)
  }

  const userStats = [...userMap.entries()].map(([userId, data]) => {
    const allUserLogs  = [...data.wizardLogs, ...data.photoOnlyLogs]
    const durations    = allUserLogs.map(l => l.durationMs)
    return {
      userId,
      name:          data.name,
      totalLots:     allUserLogs.length,
      wizardLots:    data.wizardLogs.length,
      photoOnlyLots: data.photoOnlyLogs.length,
      avgMs:         avg(durations),
      fastestMs:     Math.min(...durations),
      slowestMs:     Math.max(...durations),
      wizardAvgMs:   data.wizardLogs.length ? avg(data.wizardLogs.map(l => l.durationMs)) : 0,
      photoAvgMs:    data.photoOnlyLogs.length ? avg(data.photoOnlyLogs.map(l => l.durationMs)) : 0,
    }
  }).sort((a, b) => b.totalLots - a.totalLots)

  // ── Per-auction stats ──
  const auctionMap = new Map<string, { name: string; code: string; logs: typeof logs }>()
  for (const log of logs) {
    if (!auctionMap.has(log.auctionId)) {
      auctionMap.set(log.auctionId, { name: log.auction.name, code: log.auction.code, logs: [] })
    }
    auctionMap.get(log.auctionId)!.logs.push(log)
  }
  const auctionStats = [...auctionMap.entries()]
    .map(([id, data]) => ({
      id,
      name: data.name,
      code: data.code,
      total: data.logs.length,
      avgMs: avg(data.logs.map(l => l.durationMs)),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // Recent 50 logs
  const recentLogs = logs.slice(0, 50)

  // ── Render ──
  return (
    <div className="p-6 space-y-8 overflow-y-auto h-full text-sm">
      <div>
        <h1 className="text-lg font-bold text-gray-100 mb-0.5">Cataloguing Stats</h1>
        <p className="text-xs text-gray-500">Time tracked from barcode entry to lot save.</p>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Lots Logged",   value: logs.length.toLocaleString(),  sub: "all time" },
          { label: "Average Time / Lot",  value: fmtDuration(overallAvg),       sub: "all users" },
          { label: "Fastest Lot",         value: fmtDuration(overallMin),        sub: "record" },
          { label: "Lots Today",          value: lotsToday.toLocaleString(),     sub: format(new Date(), "d MMM yyyy") },
        ].map(card => (
          <div key={card.label} className="bg-[#1C1C1E] border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className="text-2xl font-bold text-[#2AB4A6]">{card.value}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Per-user table ── */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Per Cataloguer</h2>
        <div className="bg-[#1C1C1E] border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-[10px] uppercase tracking-wider">
                <th className="text-left px-4 py-3">Cataloguer</th>
                <th className="text-right px-4 py-3">Total Lots</th>
                <th className="text-right px-4 py-3">Wizard</th>
                <th className="text-right px-4 py-3">Photo Only</th>
                <th className="text-right px-4 py-3">Avg Time</th>
                <th className="text-right px-4 py-3">Wizard Avg</th>
                <th className="text-right px-4 py-3">Photo Avg</th>
                <th className="text-right px-4 py-3">Fastest</th>
                <th className="text-right px-4 py-3">Slowest</th>
              </tr>
            </thead>
            <tbody>
              {userStats.map((u, i) => (
                <tr key={u.userId} className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? "" : "bg-[#141416]"}`}>
                  <td className="px-4 py-3 font-semibold text-gray-200">{u.name}</td>
                  <td className="px-4 py-3 text-right text-[#2AB4A6] font-bold">{u.totalLots}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{u.wizardLots}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{u.photoOnlyLots}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">{fmtDuration(u.avgMs)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">{u.wizardLots ? fmtDuration(u.wizardAvgMs) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">{u.photoOnlyLots ? fmtDuration(u.photoAvgMs) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-400">{fmtDuration(u.fastestMs)}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-400">{fmtDuration(u.slowestMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Per-auction breakdown ── */}
      {auctionStats.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">By Auction (Top 10)</h2>
          <div className="bg-[#1C1C1E] border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-[10px] uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Auction</th>
                  <th className="text-right px-4 py-3">Lots Logged</th>
                  <th className="text-right px-4 py-3">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {auctionStats.map((a, i) => (
                  <tr key={a.id} className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? "" : "bg-[#141416]"}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[#2AB4A6] mr-2">{a.code}</span>
                      <span className="text-gray-400">{a.name}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-200">{a.total}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-300">{fmtDuration(a.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Recent activity ── */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Recent Activity (last 50)</h2>
        <div className="bg-[#1C1C1E] border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-[10px] uppercase tracking-wider">
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Cataloguer</th>
                <th className="text-left px-4 py-3">Auction</th>
                <th className="text-left px-4 py-3">Lot</th>
                <th className="text-left px-4 py-3">Method</th>
                <th className="text-right px-4 py-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log, i) => (
                <tr key={log.id} className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? "" : "bg-[#141416]"}`}>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                    {format(log.savedAt, "dd/MM/yy HH:mm:ss")}
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 font-medium">{log.userName}</td>
                  <td className="px-4 py-2.5 font-mono text-[#2AB4A6]">{log.auction.code}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-400">{log.lotNumber || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      log.method === "WIZARD" ? "bg-blue-900/40 text-blue-300" : "bg-purple-900/40 text-purple-300"
                    }`}>
                      {log.method === "WIZARD" ? "Wizard" : "Photo"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-gray-200">
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
