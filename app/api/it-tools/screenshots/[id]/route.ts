import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2, getObjectBuffer } from "@/lib/r2"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"

// GET /api/it-tools/screenshots/[id] — the PNG itself, streamed through the Hub.
// Same-origin on purpose: thumbnails, the viewer, "Copy image" (which has to
// fetch() the bytes) and Download all just work without the bucket needing a
// CORS rule for the Hub, and a screenshot is a few MB at most. ?download=1 sets
// an attachment disposition with the title as the filename.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const rec = await prisma.screenCapture.findUnique({ where: { id } })
    if (!rec) return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })

    const buf = await getObjectBuffer(rec.key)
    const download = new URL(req.url).searchParams.get("download")
    // ASCII only and no quotes — it goes inside a quoted header value.
    const safe = (rec.title.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim() || "screenshot").slice(0, 100)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": rec.contentType,
        "Content-Length": String(buf.length),
        "Content-Disposition": download ? `attachment; filename="${safe}.png"` : "inline",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e: any) {
    console.error("it-tools/screenshots/[id] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE — the file first, then the row, so a failed R2 delete leaves the row
// (and the file) rather than an orphaned file nobody can see to clean up.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const rec = await prisma.screenCapture.findUnique({ where: { id } })
    if (!rec) return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })

    await r2.send(new DeleteObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: rec.key }))
    await prisma.screenCapture.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("it-tools/screenshots/[id] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
