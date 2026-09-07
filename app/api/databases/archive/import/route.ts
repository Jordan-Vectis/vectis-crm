import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getObjectStream } from "@/lib/r2"
import { readArchiveStream, type ArchiveRow } from "@/lib/archive-import"

// Databases → Lot Archive import. The spreadsheet is STREAMED from R2 row by row and
// loaded 2,000 at a time by a loop that runs on the server after the request has
// returned — the page just polls. (Reading the whole workbook into memory is what
// broke the first version on the real 136 MB export.)
//   POST { key, filename }  → creates an ArchiveImport job, starts the loop, returns it
//   POST { jobId }          → resumes a stopped job from its offset
//   GET  ?jobId=            → the job as it stands (no jobId = the latest job)
// Rows already present (same AuctionID + Lot) are SKIPPED, not overwritten, so a
// re-run with a newer export only ever adds.
const CHUNK = 2000
const active = new Map<string, { stop: boolean }>()

type Job = NonNullable<Awaited<ReturnType<typeof prisma.archiveImport.findUnique>>>
const withRunning = (j: Job) => ({ ...j, running: active.has(j.id) })

async function runImport(jobId: string) {
  const ctl = { stop: false }; active.set(jobId, ctl)
  let stream: import("node:stream").Readable | null = null
  try {
    const job = await prisma.archiveImport.findUniqueOrThrow({ where: { id: jobId } })
    const ext = job.key.split(".").pop()?.toLowerCase() ?? "xlsx"
    stream = await getObjectStream(job.key)
    let seen = 0, bad = 0, batch: ArchiveRow[] = []
    const flush = async () => {
      if (!batch.length) return
      const res = await prisma.archiveLot.createMany({ data: batch, skipDuplicates: true })
      await prisma.archiveImport.update({
        where: { id: jobId },
        data: { offset: seen, totalRows: seen, added: { increment: res.count }, skipped: { increment: batch.length - res.count }, bad: { increment: bad } },
      })
      bad = 0; batch = []
    }
    await readArchiveStream(stream, ext, async r => {
      if (ctl.stop) throw new Error("__stopped__")
      seen++
      if (seen <= job.offset) return                                  // already loaded on an earlier run
      if (r === "bad") { bad++; return }
      batch.push(r)
      if (batch.length >= CHUNK) await flush()
    })
    await flush()
    await prisma.archiveImport.update({ where: { id: jobId }, data: { done: true, offset: seen, totalRows: seen } })
  } catch (e: any) {
    if (e?.message !== "__stopped__") {
      console.error("databases/archive/import loop error:", e)
      await prisma.archiveImport.update({ where: { id: jobId }, data: { error: e?.message ?? "Import stopped with an error" } }).catch(() => {})
    }
  } finally {
    try { stream?.destroy() } catch {}
    active.delete(jobId)
  }
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
    const job = jobId
      ? await prisma.archiveImport.findUnique({ where: { id: jobId } })
      : await prisma.archiveImport.findFirst({ orderBy: { createdAt: "desc" } })
    if (!job) return NextResponse.json(null)
    return NextResponse.json(withRunning(job))
  } catch (e: any) {
    console.error("databases/archive/import GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requireAdmin(); if (g.error) return g.error
    const body = await req.json()

    if (body?.action === "stop" && typeof body.jobId === "string") {
      const c = active.get(body.jobId); if (c) c.stop = true
      const job = await prisma.archiveImport.findUnique({ where: { id: body.jobId } })
      return NextResponse.json(job ? { ...job, running: false } : null)
    }

    // ── Start ──
    if (typeof body?.key === "string" && !body.jobId) {
      const key = body.key as string
      if (!key.startsWith("archive-imports/")) return NextResponse.json({ error: "Bad key" }, { status: 400 })
      const job = await prisma.archiveImport.create({
        data: { key, filename: String(body.filename ?? "").slice(0, 200) || "lot export", startedBy: g.session.user?.email ?? "unknown" },
      })
      void runImport(job.id)
      return NextResponse.json({ ...job, running: true })
    }

    // ── Resume ──
    const job = await prisma.archiveImport.findUnique({ where: { id: String(body?.jobId ?? "") } })
    if (!job) return NextResponse.json({ error: "No such import" }, { status: 404 })
    if (job.done || active.has(job.id)) return NextResponse.json(withRunning(job))
    await prisma.archiveImport.update({ where: { id: job.id }, data: { error: null } })
    void runImport(job.id)
    return NextResponse.json({ ...job, error: null, running: true })
  } catch (e: any) {
    console.error("databases/archive/import POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
