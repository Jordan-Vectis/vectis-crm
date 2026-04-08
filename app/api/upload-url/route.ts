import { NextRequest, NextResponse } from "next/server"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { r2 } from "@/lib/r2"

const MAX_TOTAL_SIZE = 5 * 1024 * 1024 * 1024 // 5GB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/jpg", "application/pdf"]

export async function POST(req: NextRequest) {
  const { filename, contentType, size } = await req.json()

  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 })
  }

  if (size > MAX_TOTAL_SIZE) {
    return NextResponse.json({ error: "File too large" }, { status: 400 })
  }

  const key = `submissions/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`

  const url = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.json({ url, key })
}
