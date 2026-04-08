import { NextResponse } from "next/server"
import { auth } from "@/auth"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
    const json = await res.json()
    const models = (json.models ?? [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: any) => m.name.replace("models/", ""))
    return NextResponse.json({ models })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
