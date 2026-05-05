import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 300

const SYSTEM_INSTRUCTION = `You are a strict fact-checker for auction house lot descriptions.

You will be given two descriptions of the same lot:
1. Reference description — written by a human cataloguer (treat this as ground truth)
2. New description — AI-generated (this is what you are checking)

Your task is to identify factual problems in the new description when compared to the reference.

WHAT TO FLAG:
- Contradictions: facts in the new description that directly conflict with the reference (e.g. different model number, wrong colour, incorrect condition, different manufacturer, wrong era or date)
- Unsupported claims: specific factual statements in the new description that cannot be verified from the reference and could easily be wrong (e.g. specific catalogue numbers, edition details, dates not mentioned in the reference)

WHAT NOT TO FLAG:
- Rephrasing or different wording of the same fact
- General contextual information that is clearly accurate (e.g. brief manufacturer history that does not contradict the reference)
- Style differences, additional positive language, or descriptive embellishment that does not introduce specific facts
- Omissions — only flag what is wrong or unverifiable, not what is missing

If contradictions and unsupported are both empty, set verdict to "ok", otherwise "issues".

Respond with ONLY valid JSON — no markdown, no code fences:
{"contradictions":"<description of contradicting facts, or empty string if none>","unsupported":"<comma-separated list of specific unverifiable claims, or empty string if none>","verdict":"ok or issues"}`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  const { lots, model } = await req.json() as {
    lots: { label: string; reference: string; description: string }[]
    model?: string
  }
  if (!lots?.length) return NextResponse.json({ error: "No lots provided" }, { status: 400 })

  const genAI = new GoogleGenerativeAI(apiKey)
  const ai = genAI.getGenerativeModel({
    model: model ?? "gemini-2.5-flash-preview-04-17",
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
              `Reference description (ground truth):\n${lot.reference}\n\n` +
              `New description (to check):\n${lot.description}`

            const result = await ai.generateContent(prompt)
            const raw = result.response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "")

            let contradictions = ""
            let unsupported    = ""
            let verdict: "ok" | "issues" = "ok"

            try {
              const parsed   = JSON.parse(raw)
              contradictions = parsed.contradictions?.trim() || ""
              unsupported    = parsed.unsupported?.trim()    || ""
              verdict        = contradictions || unsupported ? "issues" : "ok"
            } catch {
              // Gemini didn't return valid JSON — treat it as an issue to be safe
              contradictions = raw.slice(0, 200)
              verdict        = "issues"
            }

            send({ type: "result", index: i, label: lot.label, verdict, contradictions, unsupported })
            success = true
          } catch (e: any) {
            const msg: string = e.message ?? ""
            const isRetryable = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("503")
            if (isRetryable && attempt < 2) {
              await new Promise(r => setTimeout(r, 8000 * (attempt + 1)))
              attempt++
            } else {
              send({ type: "error", index: i, label: lot.label, error: msg || "Failed" })
              success = true
            }
          }
        }

        if (i < lots.length - 1) await new Promise(r => setTimeout(r, 2000))
      }

      send({ type: "done" })
      controller.close()
    },
  })

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } })
}
