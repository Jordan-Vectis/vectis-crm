import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET — list all macro files
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const files = await prisma.macroFile.findMany({
    select: { id: true, name: true, filename: true, description: true, mimeType: true, size: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(files)
}

// POST — upload a new macro file
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  try {
    const form = await req.formData()
    const file = form.get("file") as File | null
    const name = (form.get("name") as string | null)?.trim()
    const description = (form.get("description") as string | null)?.trim() || null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!name)  return NextResponse.json({ error: "Name is required" }, { status: 400 })

    const buffer  = Buffer.from(await file.arrayBuffer())
    const created = await prisma.macroFile.create({
      data: {
        name,
        filename:    file.name,
        description,
        content:     buffer,
        mimeType:    file.type || "text/plain",
        size:        buffer.length,
      },
      select: { id: true, name: true, filename: true, description: true, mimeType: true, size: true, createdAt: true },
    })
    return NextResponse.json(created)
  } catch (e: any) {
    console.error("[macros POST]", e)
    return NextResponse.json({ error: e.message ?? "Upload failed" }, { status: 500 })
  }
}
