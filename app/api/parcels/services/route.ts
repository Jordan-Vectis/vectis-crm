import { NextResponse } from "next/server"
import { auth } from "@/auth"

const RM_BASE = "https://api.parcel.royalmail.com/api/v1"

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const key = process.env.ROYAL_MAIL_API_KEY
    if (!key) return NextResponse.json({ error: "ROYAL_MAIL_API_KEY not set" }, { status: 500 })

    // Hit the RM API to discover available services for this account
    const res = await fetch(`${RM_BASE}/services`, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    })

    const text = await res.text()
    console.log("[RM services]", res.status, text)

    return NextResponse.json({ status: res.status, body: text })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
