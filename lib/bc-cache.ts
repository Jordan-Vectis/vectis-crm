import { prisma } from "@/lib/prisma"

let tableReady = false

async function ensureTable() {
  if (tableReady) return
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_bc_cache" (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  tableReady = true
}

export async function getCachedBC<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    await ensureTable()
    const rows = await prisma.$queryRawUnsafe<{ data: unknown; cached_at: Date }[]>(
      `SELECT data, cached_at FROM "_bc_cache" WHERE key = $1`,
      key
    )
    if (!rows.length) return null
    if (Date.now() - new Date(rows[0].cached_at).getTime() > ttlMs) return null
    return rows[0].data as T
  } catch { return null }
}

export async function setCachedBC<T>(key: string, data: T): Promise<void> {
  try {
    await ensureTable()
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_bc_cache" (key, data, cached_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $2::jsonb, cached_at = NOW()`,
      key,
      JSON.stringify(data)
    )
  } catch {}
}
