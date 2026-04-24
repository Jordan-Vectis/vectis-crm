import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 })

  const { model } = await req.json()
  if (!model) return NextResponse.json({ error: "No model specified" }, { status: 400 })

  const start = Date.now()
  try {
    const genai    = new GoogleGenerativeAI(apiKey)
    const instance = genai.getGenerativeModel({ model })
    const result   = await instance.generateContent("Reply with one word: OK")
    result.response.text() // ensure response is consumed
    return NextResponse.json({ ok: true, ms: Date.now() - start })
  } catch (e: any) {
    return NextResponse.json({ ok: false, ms: Date.now() - start, error: e.message ?? String(e) })
  }
}
