import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  const formData = await req.formData()

  const message           = formData.get("message") as string ?? ""
  const systemInstruction = formData.get("systemInstruction") as string ?? ""
  const historyRaw        = formData.get("history") as string ?? "[]"
  const imageFiles        = formData.getAll("images") as File[]
  const modelId           = formData.get("model") as string || "gemini-2.0-flash"

  // Build image parts from uploaded files
  const imageParts = await Promise.all(
    imageFiles.map(async (file) => {
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString("base64")
      return {
        inlineData: {
          data: base64,
          mimeType: file.type || "image/jpeg",
        },
      }
    })
  )

  // Parse chat history
  const history: { role: "user" | "model"; parts: { text: string }[] }[] = JSON.parse(historyRaw)

  const genai = new GoogleGenerativeAI(apiKey)

  // Append a grounding-specific instruction so the model knows to actively
  // search for catalogue numbers rather than omitting them when unsure.
  const groundingAddendum = `

IMPORTANT — You have access to Google Search. Use it proactively:
- When you can identify a manufacturer and rough product description from the photos but cannot read the catalogue/reference number clearly, search for it (e.g. "Hornby Thomas Tank Engine Annie Clarabel OO gauge" or "Oxford Rail 18-inch Rail Gun OO").
- Always try to confirm and include the correct manufacturer catalogue reference number in your description. Do not omit it just because you cannot read it directly from the image — search for it.
- If search results give conflicting codes, include the most commonly cited one and note any uncertainty.`

  const finalInstruction = (systemInstruction || "") + groundingAddendum

  // Google Search grounding — lets Gemini look up product codes in real time
  // rather than recalling from training data (which is often wrong for specific
  // catalogue numbers like Hornby R351 vs R350).
  // Note: not all models support grounding. If the selected model doesn't, this
  // route returns a clear error so the user can switch to a supported model.
  const model = genai.getGenerativeModel({
    model: modelId,
    systemInstruction: finalInstruction,
    tools: [{ googleSearch: {} } as any],
  })

  const chat = model.startChat({ history })

  const contentParts: any[] = [...imageParts]
  if (message) contentParts.push({ text: message })

  try {
    const result   = await chat.sendMessage(contentParts)
    const response = result.response

    // Check if the prompt itself was blocked before a response was generated
    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) {
      return NextResponse.json(
        { error: `Request blocked by Gemini (prompt): ${promptBlock}. Try simplifying the system instruction or removing unusual phrases.` },
        { status: 422 }
      )
    }

    // Check if the candidate response was blocked
    const candidate    = response.candidates?.[0]
    const finishReason = candidate?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      const safetyRatings = candidate?.safetyRatings
        ?.filter((r: any) => r.probability !== "NEGLIGIBLE" && r.probability !== "LOW")
        ?.map((r: any) => `${r.category}: ${r.probability}`)
        ?.join(", ") ?? ""
      return NextResponse.json(
        { error: `Response blocked by Gemini (${finishReason})${safetyRatings ? ` — ${safetyRatings}` : ""}. The system instruction may contain phrases that trigger content filters.` },
        { status: 422 }
      )
    }

    const reply = response.text()

    // Surface whether grounding was actually used so the UI can show it
    const groundingMetadata = candidate?.groundingMetadata
    const searchQueries = (groundingMetadata as any)?.webSearchQueries ?? []

    return NextResponse.json({ reply, searchQueries })
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    // Give a clear message if the model doesn't support grounding
    if (msg.includes("400") || msg.toLowerCase().includes("tool") || msg.toLowerCase().includes("grounding")) {
      return NextResponse.json(
        { error: `This model does not support Google Search grounding. Try switching to gemini-2.0-flash or gemini-1.5-pro in the sidebar.` },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
