import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 120

export type LotGroup = {
  id:           number
  title:        string
  items:        string[]
  estimateLow:  number
  estimateHigh: number
  position:     "top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right"
  notes:        string
  colour:       string
}

export type LottingUpResult = {
  totalEstimateLow:  number
  totalEstimateHigh: number
  groups:            LotGroup[]
}

const COLOURS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#84cc16", // lime
]

const SYSTEM_PROMPT = `You are an expert auction cataloguer at Vectis, a specialist toy and collectible auction house.

You will be given a photo of items laid out for cataloguing. Your job is to:
1. Identify all visible items
2. Group them into logical auction lots based on type, theme, value, and what collectors would want together
3. Estimate a sale value for each lot based on typical Vectis auction results
4. Also estimate the total value of everything in the photo

Return ONLY valid JSON in this exact format — no markdown, no explanation, just the JSON:

{
  "totalEstimateLow": <number>,
  "totalEstimateHigh": <number>,
  "groups": [
    {
      "id": 1,
      "title": "<short lot title>",
      "items": ["<item 1>", "<item 2>"],
      "estimateLow": <number>,
      "estimateHigh": <number>,
      "position": "<one of: top-left | top-center | top-right | middle-left | middle-center | middle-right | bottom-left | bottom-center | bottom-right>",
      "notes": "<any condition notes or relevant detail>"
    }
  ]
}

Rules:
- position must describe roughly where in the photo the items for that lot are located
- Combine items of similar type/theme/value into sensible lots
- Do not create lots worth less than £5
- estimateLow and estimateHigh are in GBP as whole numbers
- Keep titles concise (under 60 characters)
- items should list individual pieces clearly`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const formData = await req.formData()
    const file = formData.get("photo") as File | null
    if (!file) return NextResponse.json({ error: "No photo provided" }, { status: 400 })
    const modelId = (formData.get("model") as string | null) ?? "gemini-2.5-flash-preview-04-17"

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const mimeType = file.type || "image/jpeg"

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId })

    const result = await model.generateContent([
      SYSTEM_PROMPT,
      { inlineData: { data: base64, mimeType } },
    ])

    const raw = result.response.text().trim()
    // Strip any markdown code fences if the model adds them
    const json = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()
    const parsed: LottingUpResult = JSON.parse(json)

    // Assign colours to each group
    parsed.groups = parsed.groups.map((g, i) => ({
      ...g,
      colour: COLOURS[i % COLOURS.length],
    }))

    return NextResponse.json(parsed)
  } catch (e: any) {
    console.error("[lotting-up]", e)
    return NextResponse.json({ error: e.message ?? "Analysis failed" }, { status: 500 })
  }
}
