import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/health/db-writable  →  { writable: boolean }
//
// Asked ONLY by a screen that has already had a write refused, so it can tell the person the
// moment the database is taking work again instead of leaving them to guess. Nothing polls this
// in the normal case — a health check that runs forever on every page is a cost with no reader.
//
// ⚠ It ASKS, it does not WRITE. `default_transaction_read_only` is exactly what Postgres refuses
// the write on (SQLSTATE 25006), so reading the setting answers the question without inserting a
// probe row — which would litter a table, and would itself fail while read-only anyway.
//
// ⚠ An error is reported as `writable: null`, never as `false`. A dropped connection is not the
// same fact as "the database is refusing writes", and a banner that says "still not saving"
// because the wifi blipped would send people home for nothing.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const rows = await prisma.$queryRaw<{ ro: string }[]>`
      SELECT current_setting('default_transaction_read_only') AS ro`
    const ro = rows[0]?.ro
    return NextResponse.json({ writable: ro === "off", readOnlySetting: ro ?? null })
  } catch (e: any) {
    console.error("db-writable error:", e)
    return NextResponse.json({ writable: null, error: e?.message ?? "Could not ask the database" }, { status: 200 })
  }
}
