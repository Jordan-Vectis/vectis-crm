import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET — download file content
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await params
  const file = await prisma.macroFile.findUnique({ where: { id } })
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return new Response(file.content, {
    headers: {
      "Content-Type":        file.mimeType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length":      String(file.size),
    },
  })
}

// DELETE — remove a macro file
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await params
  await prisma.macroFile.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
