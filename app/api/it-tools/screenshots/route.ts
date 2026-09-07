import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import { HeadObjectCommand } from "@aws-sdk/client-s3"

// GET /api/it-tools/screenshots — every saved screenshot, newest first.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const rows = await prisma.screenCapture.findMany({ orderBy: { createdAt: "desc" }, take: 500 })
    return NextResponse.json(rows)
  } catch (e: any) {
    console.error("it-tools/screenshots GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// Exactly the shape upload-url mints — never a prefix check.
const KEY_RE = /^screenshots\/\d{8}-\d{6}-[a-z0-9]{6}\.png$/

// POST /api/it-tools/screenshots — record a finished upload. Confirms the object
// is really in R2 first, and is idempotent on key (a retried save returns the
// existing row rather than making a second one for the same file).
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const key = typeof body?.key === "string" ? body.key : ""
    const sizeBytes = Number(body?.sizeBytes), width = Number(body?.width), height = Number(body?.height)
    const title = String(body?.title ?? "").trim().slice(0, 120)

    if (!KEY_RE.test(key)) return NextResponse.json({ error: "Bad key" }, { status: 400 })
    for (const [n, v] of [["size", sizeBytes], ["width", width], ["height", height]] as const) {
      if (!Number.isFinite(v) || v <= 0 || v > 2_147_483_647) return NextResponse.json({ error: `Bad ${n}` }, { status: 400 })
    }

    const existing = await prisma.screenCapture.findFirst({ where: { key } })
    if (existing) return NextResponse.json(existing)

    // Only a definite 404 means "nothing was saved"; anything else may well be there.
    try {
      await r2.send(new HeadObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key }))
    } catch (e: any) {
      const status = e?.$metadata?.httpStatusCode
      if (e?.name === "NotFound" || e?.name === "NoSuchKey" || status === 404) {
        return NextResponse.json({ error: "The upload didn't reach storage — nothing was saved. Try again." }, { status: 409 })
      }
      console.error("it-tools/screenshots POST: couldn't confirm object", key, e)
      return NextResponse.json({ error: "Couldn't confirm the upload reached storage — it may well be there. Try saving again in a moment." }, { status: 503 })
    }

    const row = await prisma.screenCapture.create({
      data: {
        title: title || `Screenshot ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}`,
        key, contentType: "image/png",
        sizeBytes: Math.round(sizeBytes), width: Math.round(width), height: Math.round(height),
        takenBy: session.user?.email ?? "unknown",
        takenByName: session.user?.name ?? session.user?.email ?? "unknown",
      },
    })
    return NextResponse.json(row)
  } catch (e: any) {
    console.error("it-tools/screenshots POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
