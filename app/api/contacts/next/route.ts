import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

export async function GET() {
  try {
    const session = await auth()
    if (!session) throw new Error("Not authenticated")
    const contacts = await prisma.contact.findMany({ select: { id: true } })
    let maxNum = 0
    for (const c of contacts) {
      const num = parseInt(c.id.replace(/^\D+/, ""), 10)
      if (!isNaN(num) && num > maxNum) maxNum = num
    }
    return NextResponse.json({ id: `c${String(maxNum + 1).padStart(5, "0")}` })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
