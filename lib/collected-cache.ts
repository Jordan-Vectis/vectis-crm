import { getCachedBC, setCachedBC } from "./bc-cache"
import { bcFetchAllWithProgress } from "./bc"

const RAW_CACHE_KEY = "change-log-collected:raw"
const TTL_ONE_WEEK  = 7 * 24 * 60 * 60 * 1000

/**
 * Returns all Date_and_Time strings for COLLECTED ChangeLogEntries.
 * On cache hit: instant (no BC call). On miss: fetches from BC and caches forever.
 * onProgress is only called on a cache miss.
 */
export async function getCollectedDates(
  token: string,
  onProgress: (done: number, total: number) => void
): Promise<string[]> {
  const cached = await getCachedBC<string[]>(RAW_CACHE_KEY, TTL_ONE_WEEK)
  if (cached) return cached

  const filter = `New_Value eq 'COLLECTED' and Field_Caption eq 'Article Location Code'`
  const rows = await bcFetchAllWithProgress(
    token, "ChangeLogEntries", filter, "Date_and_Time", 500, onProgress
  )
  const dates = rows.map((r: any) => r.Date_and_Time ?? "").filter(Boolean)
  await setCachedBC(RAW_CACHE_KEY, dates)
  return dates
}
