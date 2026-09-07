import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { prisma } from "@/lib/prisma"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomBytes } from "node:crypto"

// The archive spreadsheet is twenty years of lots — far past the 20 MB server body
// limit — so it goes straight to R2 on a presigned PUT and the import route reads it
// from there. Admin only: this loads a whole table.
const MAX_SIZE = 500 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const { filename, size } = await req.json()
    if (typeof size !== "number" || !(size > 0)) return NextResponse.json({ error: "Missing size" }, { status: 400 })
    if (size > MAX_SIZE) return NextResponse.json({ error: "File too large (max 500 MB)" }, { status: 400 })
    const ext = /\.xlsm$/i.test(String(filename)) ? "xlsm" : /\.xls$/i.test(String(filename)) ? "xls" : /\.csv$/i.test(String(filename)) ? "csv" : "xlsx"

    // Fail at the free step if the tables aren't there yet (Run Migrations).
    await prisma.archiveImport.findFirst({ select: { id: true } })

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-")
    const key = `archive-imports/${stamp}-${randomBytes(3).toString("hex")}.${ext}`
    const contentType = "application/octet-stream"
    const url = await getSignedUrl(r2, new PutObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key, ContentType: contentType }), { expiresIn: 3600 })
    return NextResponse.json({ url, key, contentType })
  } catch (e: any) {
    console.error("databases/archive/upload-url POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
