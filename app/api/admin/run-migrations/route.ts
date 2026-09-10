import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { MIGRATIONS, MIGRATIONS_HASH } from "@/lib/migrations"

// POST /api/admin/run-migrations
// Runs any missing column additions directly via SQL.
// Safe to call multiple times — all statements use IF NOT EXISTS.
//
// GET /api/admin/run-migrations
// Reports whether this deploy has migrations the DB hasn't had run yet, so the
// app can show admins a banner instead of a human having to remember. A clean
// POST stamps the hash of the MIGRATIONS array below into MigrationState; if the
// array has changed since (or was never run) the hashes differ → pending.

// GET — is this deploy's SQL already applied? Admin-only; everyone else gets
// pending:false so no one but an admin can see the banner.
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ pending: false })
    }

    // The MigrationState table itself arrives via the array above, so a missing
    // table means nothing has been run on this DB yet → pending (self-healing).
    let pending = true
    let ranAt: Date | null = null
    try {
      const row = await prisma.migrationState.findUnique({ where: { id: "current" } })
      pending = !row || row.hash !== MIGRATIONS_HASH
      ranAt = row?.ranAt ?? null
    } catch {
      pending = true
    }

    return NextResponse.json({ pending, ranAt })
  } catch (e: any) {
    console.error("run-migrations GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    // Each statement is idempotent (IF NOT EXISTS / ON CONFLICT), so a single
    // failure should NOT block the rest — record it and carry on, then report.
    const results: string[] = []
    const errors: string[] = []
    for (const sql of MIGRATIONS) {
      try {
        await prisma.$executeRawUnsafe(sql)
        results.push(`OK: ${sql.slice(0, 60)}…`)
      } catch (e: any) {
        errors.push(`FAIL: ${sql.slice(0, 80)}… — ${e?.message ?? e}`)
      }
    }

    // Only stamp on a fully clean run — a failure must leave the banner up.
    if (errors.length === 0) {
      try {
        await prisma.migrationState.upsert({
          where: { id: "current" },
          create: { id: "current", hash: MIGRATIONS_HASH, ranBy: session.user.name ?? session.user.email ?? null },
          update: { hash: MIGRATIONS_HASH, ranBy: session.user.name ?? session.user.email ?? null },
        })
      } catch (e: any) {
        errors.push(`FAIL: could not record migration state — ${e?.message ?? e}`)
      }
    }

    return NextResponse.json({ ok: errors.length === 0, ran: results.length, errors })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
