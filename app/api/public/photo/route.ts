import { NextRequest, NextResponse } from "next/server"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"

// Public (no auth) proxy for lot photos — only serves lot-photos/ keys
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? ""

  if (!key || (!key.startsWith("lot-photos/") && !key.startsWith("catalogue-photos/"))) {
    return new NextResponse("Not found", { status: 404 })
  }

  try {
    const obj = await r2.send(new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: key,
    }))

    const body = obj.Body as ReadableStream | null
    if (!body) return new NextResponse("Not found", { status: 404 })

    return new NextResponse(body, {
      headers: {
        "Content-Type":  obj.ContentType ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }
}
