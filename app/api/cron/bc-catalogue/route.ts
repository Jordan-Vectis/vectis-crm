import { NextRequest } from "next/server"
import { getBCTokenAny, bcFetchAll } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 })
  }

  const token = await getBCTokenAny()
  if (!token) return Response.json({ error: "No BC token available" }, { status: 503 })

  // Fetch any uncached past dates from the last 90 days (catches gaps + yesterday)
  const today = toDateStr(new Date())
  const ninetyDaysAgo = toDateStr(addDays(new Date(), -90))

  const allPastDates: string[] = []
  let cur = new Date(ninetyDaysAgo + "T00:00:00Z")
  const todayDate = new Date(today + "T00:00:00Z")
  while (cur < todayDate) {
    allPastDates.push(toDateStr(cur))
    cur = addDays(cur, 1)
  }

  // Find which are already cached
  const cached = await prisma.bCCatalogueDay.findMany({
    where: { date: { in: allPastDates } },
    select: { date: true },
  })
  const cachedSet = new Set(cached.map(r => r.date))
  const toFetch = allPastDates.filter(dt => !cachedSet.has(dt))

  if (toFetch.length === 0) {
    return Response.json({ ok: true, message: "All dates already cached" })
  }

  // Fetch from BC in 7-day chunks, 4 at a time
  const chunks: { start: string; end: string }[] = []
  for (let i = 0; i < toFetch.length; i += 7) {
    const slice = toFetch.slice(i, i + 7)
    chunks.push({ start: slice[0], end: slice[slice.length - 1] })
  }

  const PARALLEL = 4
  const freshRows: { User_ID: string; Date_and_Time: string }[] = []

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async ({ start, end }) => {
        const filter =
          `Date_and_Time ge ${start}T00:00:00Z ` +
          `and Date_and_Time le ${end}T23:59:59Z ` +
          `and Field_Caption eq 'Internal Barcode'`
        try {
          return await bcFetchAll(token, "ChangeLogEntries", filter, "User_ID,Date_and_Time")
        } catch {
          return []
        }
      })
    )
    results.forEach(rows => freshRows.push(...rows))
  }

  // Aggregate per user per day
  const agg: Record<string, Record<string, number>> = {}
  for (const r of freshRows) {
    const day = r.Date_and_Time?.slice(0, 10) ?? ""
    if (!day || day >= today) continue
    if (!agg[day]) agg[day] = {}
    agg[day][r.User_ID] = (agg[day][r.User_ID] ?? 0) + 1
  }

  // Persist to cache
  const entryUpserts = toFetch.flatMap(day =>
    Object.entries(agg[day] ?? {}).map(([userId, count]) =>
      prisma.bCCatalogueEntry.upsert({
        where:  { date_userId: { date: day, userId } },
        create: { date: day, userId, count },
        update: { count },
      })
    )
  )
  const dayUpserts = toFetch.map(date =>
    prisma.bCCatalogueDay.upsert({
      where:  { date },
      create: { date },
      update: { fetchedAt: new Date() },
    })
  )
  await Promise.all([...entryUpserts, ...dayUpserts])

  console.log(`[cron/bc-catalogue] Cached ${toFetch.length} dates, ${freshRows.length} entries`)
  return Response.json({ ok: true, datesCached: toFetch.length, entriesStored: freshRows.length })
}
