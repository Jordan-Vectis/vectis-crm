import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 300

const SYSTEM_INSTRUCTION = `You are a description quality checker for an auction house.
Your job is to verify that an auction lot description includes every key point provided by the cataloguer.
Key points are facts recorded by the cataloguer who physically examined the item — they are authoritative and must be treated as ground truth.
Rules:
- If all key points are already present and accurate in the description, return the description unchanged.
- If any key point is missing, misrepresented, or contradicted, rewrite the description to naturally incorporate it while keeping the same style, tone, length, and format as the original.
- Never invent new facts beyond what is in the key points or the existing description.
- Respond with ONLY the final description text — no commentary, no preamble, no explanation.`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  const { lots, model } = await req.json() as {
    lots: { label: string; keyPoints: string; description: string }[]
    model?: string
  }
  if (!lots?.length) return NextResponse.json({ error: "No lots provided" }, { status: 400 })

  const genAI = new GoogleGenerativeAI(apiKey)
  const ai = genAI.getGenerativeModel({
    model: model ?? "gemini-2.0-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      }

      send({ type: "total", count: lots.length })

      for (let i = 0; i < lots.length; i++) {
        const lot = lots[i]
        send({ type: "progress", index: i, label: lot.label })

        let attempt = 0
        let success = false

        while (attempt < 3 && !success) {
          try {
            const prompt =
              `Lot: ${lot.label}\n\n` +
              `Key points (all must appear in the description):\n${lot.keyPoints}\n\n` +
              `Current description:\n${lot.description}`

            const result = await ai.generateContent(prompt)
            const revised = result.response.text().trim()
            const changed = revised !== lot.description.trim()

            send({ type: "result", index: i, label: lot.label, revised, changed })
            success = true
          } catch (e: any) {
            const msg: string = e.message ?? ""
            const isRetryable = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("503")
            if (isRetryable && attempt < 2) {
              await new Promise(r => setTimeout(r, 8000 * (attempt + 1)))
              attempt++
            } else {
              send({ type: "error", index: i, label: lot.label, error: msg || "Failed" })
              success = true // break retry loop
            }
          }
        }

        // Delay between lots to avoid rate limiting
        if (i < lots.length - 1) await new Promise(r => setTimeout(r, 2000))
      }

      send({ type: "done" })
      controller.close()
    },
  })

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } })
}
