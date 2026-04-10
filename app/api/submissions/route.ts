import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const contactId = searchParams.get("contact_id")

  const submissions = await prisma.submission.findMany({
    where: contactId ? { contactId } : undefined,
    include: {
      contact: true,
      items: true,
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(submissions)
}
