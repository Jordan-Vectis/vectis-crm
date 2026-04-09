import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  const formData = await req.formData()
  const systemInstruction = formData.get("systemInstruction") as string ?? ""
  const modelId           = formData.get("model") as string || "gemini-3-flash-preview"

  // Each lot is submitted as: lot_{name}_image_{i} files
  // We reconstruct the lots from the file field names
  const lotMap: Record<string, File[]> = {}
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^lot_(.+)_image_\d+$/)
    if (m && value instanceof File) {
      const lot = m[1]
      if (!lotMap[lot]) lotMap[lot] = []
      lotMap[lot].push(value as File)
    }
  }

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: modelId,
    systemInstruction: systemInstruction || undefined,
  })

  const MAX_RETRIES    = 8
  const MAX_BACKOFF_MS = 60_000

  async function generateWithRetry(contents: any[]): Promise<string> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await model.generateContent(contents)
        return result.response.text()
      } catch (e: any) {
        const msg: string = e?.message ?? String(e)
        const isRetryable = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") ||
                            msg.includes("503") || msg.includes("Service Unavailable") ||
                            msg.includes("high demand")
        if (!isRetryable) throw e
        if (attempt === MAX_RETRIES - 1) throw e
        const backoff = Math.min(MAX_BACKOFF_MS, Math.pow(2, attempt) * 1000) + Math.random() * 1500
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
    throw new Error("Max retries exceeded")
  }

  const results: { lot: string; description: string; estimate: string; status: string; error?: string }[] = []
  const lotEntries = Object.entries(lotMap)

  for (let idx = 0; idx < lotEntries.length; idx++) {
    const [lot, files] = lotEntries[idx]
    try {
      const imageParts = await Promise.all(
        files.slice(0, 24).map(async (file) => {
          const buffer = await file.arrayBuffer()
          const base64 = Buffer.from(buffer).toString("base64")
          return { inlineData: { data: base64, mimeType: file.type || "image/jpeg" } }
        })
      )

      const text = await generateWithRetry([
        ...imageParts,
        { text: "Please describe this auction lot." },
      ])

      // Split description and estimate
      const lines = text.trim().split("\n").filter(Boolean)
      const estimateLine = lines.find((l) => l.toLowerCase().startsWith("estimate:")) ?? ""
      const description  = lines.filter((l) => !l.toLowerCase().startsWith("estimate:")).join(" ").trim()

      results.push({ lot, description, estimate: estimateLine.replace(/^Estimate:\s*/i, "").trim(), status: "OK" })

      // 8-second delay between lots (matches Python app)
      if (idx < lotEntries.length - 1) {
        await new Promise((r) => setTimeout(r, 8000))
      }
    } catch (e: any) {
      results.push({ lot, description: "", estimate: "", status: "FAILED", error: e.message })
    }
  }

  return NextResponse.json({ results })
}
