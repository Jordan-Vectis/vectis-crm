import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2, getSignedImageUrl } from "@/lib/r2"
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// GET /api/it-tools/recordings/[id] — a signed URL to play the file. The bucket
// is private; nothing is ever linked to directly.
// ?download=1 signs the same object with Content-Disposition: attachment and the
// recording's title as the filename, so the browser SAVES it instead of playing
// it inline. That header is the only reliable way: <a download> is ignored for a
// cross-origin link, and R2 is a different origin to the Hub.
// ⚠ Eight hours, not the Documents route's one: a <video> fetches lazily in Range
// requests, and every request is checked against the signature's expiry. With
// an hour, seeking or pausing-then-resuming an hour after pressing Play got a
// 403 from R2 and the player died — and the cap budgets for 1¾-hour files.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const rec = await prisma.screenRecording.findUnique({ where: { id } })
    if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 })

    if (new URL(req.url).searchParams.get("download")) {
      const ext = rec.contentType === "video/mp4" ? "mp4" : "webm"
      // ASCII only and no quotes — this goes inside a quoted header value.
      const safe = (rec.title.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim() || "recording").slice(0, 100)
      const url = await getSignedUrl(r2, new GetObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: rec.key,
        ResponseContentType: rec.contentType,
        ResponseContentDisposition: `attachment; filename="${safe}.${ext}"`,
      }), { expiresIn: 3600 })
      return NextResponse.json({ url })
    }
    return NextResponse.json({ url: await getSignedImageUrl(rec.key, 8 * 3600) })
  } catch (e: any) {
    console.error("it-tools/recordings/[id] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE /api/it-tools/recordings/[id] — the file first, then the row, so a
// failed R2 delete leaves the row (and the file) rather than an orphaned file
// nobody can see to clean up.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const rec = await prisma.screenRecording.findUnique({ where: { id } })
    if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 })

    await r2.send(new DeleteObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: rec.key }))
    await prisma.screenRecording.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("it-tools/recordings/[id] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
