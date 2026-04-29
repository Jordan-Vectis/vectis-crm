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
  bounds:       { x: number; y: number; w: number; h: number } // % of image dimensions
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
5. For each group, provide a bounding box showing where those items appear in the photo

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
      "bounds": {
        "x": <0-100>,
        "y": <0-100>,
        "w": <0-100>,
        "h": <0-100>
      },
      "notes": "<any condition notes or relevant detail>"
    }
  ]
}

BOUNDING BOX RULES — read carefully:
The image is treated as a 100×100 percentage grid.
  - x=0 is the LEFT edge of the image, x=100 is the RIGHT edge
  - y=0 is the TOP edge of the image, y=100 is the BOTTOM edge
  - x,y is the TOP-LEFT corner of the bounding box
  - w is the width of the box (how far it extends to the RIGHT from x)
  - h is the height of the box (how far it extends DOWNWARD from y)
  - The box must stay within the image: x+w <= 100, y+h <= 100

Examples of correct bounds:
  - Items filling the entire image: {x:0, y:0, w:100, h:100}
  - Items in the top half only: {x:0, y:0, w:100, h:50}
  - Items in the bottom half only: {x:0, y:50, w:100, h:50}
  - Items in the top-left quarter: {x:0, y:0, w:50, h:50}
  - Items in the centre: {x:25, y:25, w:50, h:50}

Before writing each bounds value, look at the image and estimate:
  1. Where is the TOP of this group? That is y.
  2. Where is the BOTTOM of this group? h = bottom - y.
  3. Where is the LEFT edge? That is x.
  4. Where is the RIGHT edge? w = right - x.

Other rules:
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
    const json = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()
    const parsed: LottingUpResult = JSON.parse(json)

    // Assign colours and clamp bounds
    parsed.groups = parsed.groups.map((g, i) => {
      const b = g.bounds ?? { x: 0, y: 0, w: 100, h: 100 }
      return {
        ...g,
        colour: COLOURS[i % COLOURS.length],
        bounds: {
          x: Math.max(0, Math.min(100, b.x)),
          y: Math.max(0, Math.min(100, b.y)),
          w: Math.max(1, Math.min(100 - b.x, b.w)),
          h: Math.max(1, Math.min(100 - b.y, b.h)),
        },
      }
    })

    return NextResponse.json(parsed)
  } catch (e: any) {
    console.error("[lotting-up]", e)
    return NextResponse.json({ error: e.message ?? "Analysis failed" }, { status: 500 })
  }
}
