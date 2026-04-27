import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 300

const SYSTEM_INSTRUCTION = `You are a strict quality checker for auction house lot descriptions.

Your task — follow these steps exactly:
1. Read every key point the cataloguer recorded one by one.
2. For each key point, decide: is this specific fact clearly stated in the existing description?
3. If ALL key points are present: return the description word-for-word unchanged.
4. If ANY key point is missing: insert that fact naturally into the existing description with the minimum change necessary — do NOT rewrite, restructure, condense or remove any existing content.

Critical rules:
- Every single key point MUST appear in the final description — missing even one is a failure.
- NEVER remove or shorten any existing detail from the description.
- NEVER rewrite from scratch — only insert what is missing.
- NEVER invent facts beyond what appears in the key points or the original description.
- The final description must be at least as long as the original.

Respond with ONLY valid JSON — no markdown, no code fences:
{"description":"<the full final description>","missing":"<comma-separated list of key points that were absent from the original, or empty string if none>","added":"<one sentence describing what was inserted, or empty string if nothing changed>"}`

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
            const raw = result.response.text().trim().replace(/^```json\s*/i, "").replace(/```$/,"")
            let revised = lot.description.trim()
            let missing  = ""
            let added    = ""
            try {
              const parsed = JSON.parse(raw)
              revised = parsed.description?.trim() || revised
              missing = parsed.missing?.trim()  || ""
              added   = parsed.added?.trim()    || ""
            } catch {
              // Gemini didn't return valid JSON — treat whole response as the description
              revised = raw
            }
            const changed = revised !== lot.description.trim()

            send({ type: "result", index: i, label: lot.label, revised, changed, missing, added })
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
