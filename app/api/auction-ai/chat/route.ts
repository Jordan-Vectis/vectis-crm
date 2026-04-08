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

  const message          = formData.get("message") as string ?? ""
  const systemInstruction = formData.get("systemInstruction") as string ?? ""
  const historyRaw       = formData.get("history") as string ?? "[]"
  const imageFiles       = formData.getAll("images") as File[]

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
  const model = genai.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: systemInstruction || undefined,
  })

  const chat = model.startChat({ history })

  const contentParts: any[] = [...imageParts]
  if (message) contentParts.push({ text: message })

  const result = await chat.sendMessage(contentParts)
  const reply  = result.response.text()

  return NextResponse.json({ reply })
}
