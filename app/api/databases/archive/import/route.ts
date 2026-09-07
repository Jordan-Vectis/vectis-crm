import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer } from "@/lib/r2"
import { parseArchiveSheet, type ArchiveRow } from "@/lib/archive-import"

export const maxDuration = 300

// Databases → Lot Archive import, worked through in CHUNKS the way Data Sync is:
//   POST { key, filename }  → parses the sheet, creates an ArchiveImport job, returns it
//   POST { jobId }          → loads the next chunk, returns the job (client loops until done)
//   GET  ?jobId=            → the job as it stands
// Rows already present (same AuctionID + Lot) are SKIPPED, not overwritten, so a
// re-run with a newer export only ever adds. The parsed rows are cached in memory per
// job; if the server has restarted since, the sheet is simply read from R2 again.
const CHUNK = 2000
const cache = new Map<string, ArchiveRow[]>()

async function rowsFor(job: { id: string; key: string }): Promise<ArchiveRow[]> {
  const hit = cache.get(job.id)
  if (hit) return hit
  const parsed = parseArchiveSheet(await getObjectBuffer(job.key))
  cache.set(job.id, parsed.rows)
  return parsed.rows
}

async function requireAdmin() {
  const session = await auth()
  if (!session) return { error: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) }
  if (session.user?.role !== "ADMIN") return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }) }
  return { session }
}

export async function GET(req: NextRequest) {
  try {
    const g = await requireAdmin(); if (g.error) return g.error
    const jobId = new URL(req.url).searchParams.get("jobId") ?? ""
    const job = await prisma.archiveImport.findUnique({ where: { id: jobId } })
    if (!job) return NextResponse.json({ error: "No such import" }, { status: 404 })
    return NextResponse.json(job)
  } catch (e: any) {
    console.error("databases/archive/import GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requireAdmin(); if (g.error) return g.error
    const body = await req.json()

    // ── Start ──
    if (typeof body?.key === "string" && !body.jobId) {
      const key = body.key as string
      if (!key.startsWith("archive-imports/")) return NextResponse.json({ error: "Bad key" }, { status: 400 })
      const parsed = parseArchiveSheet(await getObjectBuffer(key))
      if (!parsed.rows.length) return NextResponse.json({ error: `No usable rows found. Headers were: ${parsed.headers.join(", ")}` }, { status: 400 })
      const job = await prisma.archiveImport.create({
        data: { key, filename: String(body.filename ?? "").slice(0, 200) || "lot export", totalRows: parsed.rows.length, bad: parsed.bad, startedBy: g.session.user?.email ?? "unknown" },
      })
      cache.set(job.id, parsed.rows)
      return NextResponse.json(job)
    }

    // ── Next chunk ──
    const job = await prisma.archiveImport.findUnique({ where: { id: String(body?.jobId ?? "") } })
    if (!job) return NextResponse.json({ error: "No such import" }, { status: 404 })
    if (job.done) return NextResponse.json(job)

    const rows = await rowsFor(job)
    const slice = rows.slice(job.offset, job.offset + CHUNK)
    if (!slice.length) {
      cache.delete(job.id)
      return NextResponse.json(await prisma.archiveImport.update({ where: { id: job.id }, data: { done: true } }))
    }
    // ON CONFLICT DO NOTHING on (auctionId, lot): the unique index is the dedupe.
    const res = await prisma.archiveLot.createMany({ data: slice, skipDuplicates: true })
    const offset = job.offset + slice.length
    const done = offset >= rows.length
    if (done) cache.delete(job.id)
    const updated = await prisma.archiveImport.update({
      where: { id: job.id },
      data: { offset, added: { increment: res.count }, skipped: { increment: slice.length - res.count }, done },
    })
    return NextResponse.json(updated)
  } catch (e: any) {
    console.error("databases/archive/import POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
