import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { prisma } from "@/lib/prisma"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomBytes } from "node:crypto"

// Twin of the recordings upload-url route, for PNG screenshots. The browser PUTs
// straight to R2 on a presigned URL; the row is written by POST /api/it-tools/screenshots
// only once the object is confirmed there. See RULES.md → "IT Tools → Screen Recorder"
// for why each step is where it is — the same reasoning applies here.
const MAX_SIZE = 25 * 1024 * 1024   // a 4K PNG with mark-up is a few MB; 25 MB is generous

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { contentType, size } = await req.json()
    if (contentType !== "image/png") return NextResponse.json({ error: "Screenshots are saved as PNG" }, { status: 400 })
    if (typeof size !== "number" || !(size > 0)) return NextResponse.json({ error: "Missing size" }, { status: 400 })
    if (size > MAX_SIZE) return NextResponse.json({ error: "Screenshot too large (max 25 MB)" }, { status: 400 })

    // Fail at the free step if the table isn't there yet (Run Migrations) or the DB is down.
    await prisma.screenCapture.findFirst({ select: { id: true } })

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-")
    const key = `screenshots/${stamp}-${randomBytes(3).toString("hex")}.png`

    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key, ContentType: "image/png" }),
      { expiresIn: 3600 },
    )
    return NextResponse.json({ url, key })
  } catch (e: any) {
    console.error("it-tools/screenshots/upload-url POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
