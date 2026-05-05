import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 300

const SYSTEM_INSTRUCTION = `You are a quality checker for auction house lot descriptions. You will be given a written description and, where available, one or more photos of the lot.

WHAT TO FLAG as contradictions:
- Internal inconsistencies (e.g. description says two conflicting things about the same item)
- Obviously incorrect facts (e.g. a well-known artist attributed to the wrong label, a model number that clearly does not match the described item)
- Statements that contradict each other within the same description
- Where photos are provided: details in the description that visibly contradict what can be seen in the photos (e.g. wrong colour, wrong label, wrong format)

WHAT TO FLAG as unsupported:
- Highly specific claims that are easy to get wrong and cannot be verified from the description alone (e.g. a precise catalogue number, a specific pressing year, a claimed "first pressing" with no evidence given)
- Claims that seem invented or hallucinated rather than observed (e.g. describing features not typically visible or not readable in the provided photos)
- Where photos are provided: specific details that cannot be confirmed from the photos — for example a catalogue number that is not clearly readable, a pressing year not visible, condition claims that the photo is too blurry or cropped to confirm

WHAT NOT TO FLAG:
- General descriptive language or style choices
- Reasonable estimates or condition grades
- Facts that are plausible and commonly known (e.g. well-known band names, standard formats)
- Absence of information — only flag what is present and wrong, not what is missing

If the description appears factually sound, set verdict to "ok" and leave both fields empty.

Respond with ONLY valid JSON — no markdown, no code fences:
{"contradictions":"<description of internal inconsistencies or obvious errors, or empty string>","unsupported":"<comma-separated list of specific unverifiable claims, or empty string>","verdict":"ok or issues"}`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  const { lots, model } = await req.json() as {
    lots: { label: string; description: string; images?: { data: string; mimeType: string }[] }[]
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
            const imageParts = (lot.images ?? []).map(img => ({
              inlineData: { data: img.data, mimeType: img.mimeType },
            }))

            const textPart = { text: `Lot: ${lot.label}\n\nDescription:\n${lot.description}` }

            const contents = imageParts.length > 0
              ? [...imageParts, textPart]
              : [textPart]

            const result = await ai.generateContent(contents)
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
