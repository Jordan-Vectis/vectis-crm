import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { generateAiText } from "@/lib/ai-provider"
import { getToolModel } from "@/lib/ai-models"
import { parseModelJson } from "@/lib/model-json"
import { guessCountry } from "@/lib/vendor-country"
import { COUNTRY_NAMES } from "@/lib/country-names"

export const maxDuration = 300

// POST /api/bc/vendor-locations/resolve
// Works out the country for the vendors the address rules could not place, and writes it to
// BcVendor.resolvedCountry so the report stops calling them "Not known".
//
// ⚠ WHY AI AND NOT A LOOKUP SERVICE. What is left after the rules is "Averbode 3271",
// "Puylagarde 82160", "Dunajska Streda 92901" — a town and a bare number. Placing those needs
// world knowledge, not a pattern. A geocoding service would mean a new external supplier, a key and
// a data-sharing decision; the Hub already has a model configured and the volume is a few hundred
// rows, once.
//
// ⚠⚠ NO NAMES ARE SENT. Only town, county and postcode go to the model — never the vendor's name
// or street. A town and a postcode place a consignment; a name and a street identify a person, and
// nothing here needs that.
//
// ⚠ NOTHING IS WRITTEN BACK TO BUSINESS CENTRAL. This is the Hub's own working-out. The report
// labels it as worked out by the assistant, and one button clears the lot.
//
// ⚠ ONE BATCH PER CALL, the browser drives the loop — RULES.md §7b. A button that thinks for two
// minutes with a spinner is indistinguishable from a hang.

const BATCH = 40

type Answer = { vendorNo: string; country: string | null; note?: string }

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    let onlyMissing = true
    try {
      const body = await req.json()
      if (body?.redo === true) onlyMissing = false
    } catch { /* no body */ }

    // Everyone BC gave an address but no country, that the rules could not place.
    const all = await prisma.bcVendor.findMany({
      where:  { countryCode: null },
      select: {
        vendorNo: true, address: true, address2: true, city: true, county: true,
        postCode: true, countryCode: true, resolvedCountry: true,
      },
    })

    const todo = all.filter(v => {
      if (onlyMissing && v.resolvedCountry) return false
      if (guessCountry(v).code) return false                       // the rules already placed them
      return !!((v.city ?? "").trim() || (v.county ?? "").trim() || (v.postCode ?? "").trim())
    })

    if (todo.length === 0) {
      return NextResponse.json({ ok: true, done: true, considered: 0, written: 0, remaining: 0 })
    }

    const batch = todo.slice(0, BATCH)
    const model = await getToolModel("vendor_country")

    // Deliberately minimal: town, county, postcode. No names, no street.
    const list = batch.map(v => ({
      id:       v.vendorNo,
      town:     (v.city ?? "").trim() || null,
      county:   (v.county ?? "").trim() || null,
      postcode: (v.postCode ?? "").trim() || null,
    }))

    const system = [
      "You identify which country a postal address is in.",
      "You are given a town, a county or region, and a postcode. Any of them may be missing.",
      "Reply with the ISO 3166-1 alpha-2 country code in capitals, for example GB, FR, NL, US.",
      "If you cannot tell with confidence, return null for that entry. A wrong country is far worse than null.",
      "A bare 4 or 5 digit postcode is used by many countries — use the town name to decide, not the number alone.",
      "British English. Return JSON only, no commentary.",
    ].join(" ")

    const prompt = [
      "For each entry, give the country.",
      'Return JSON of the exact shape: {"results":[{"id":"C123456","country":"BE","note":"Averbode is in Belgium"}]}',
      'Use "country": null when you are not confident.',
      "",
      JSON.stringify(list, null, 1),
    ].join("\n")

    const raw = await generateAiText({ model, system, prompt, json: true, maxOutputTokens: 4096 })
    const parsed: any = parseModelJson(raw)
    const results: Answer[] = Array.isArray(parsed?.results) ? parsed.results : []

    const byId = new Map(results.map(r => [String(r.vendorNo ?? (r as any).id ?? "").trim().toUpperCase(), r]))

    let written = 0, refused = 0
    for (const v of batch) {
      const a = byId.get(v.vendorNo.trim().toUpperCase())
      const code = String(a?.country ?? "").trim().toUpperCase()
      // ⚠ Only a code we recognise is accepted. A model that answers "Belgium" or "EU" or invents
      // "XX" must not be able to create a country row that then looks like data.
      if (!code || !COUNTRY_NAMES[code]) { refused++; continue }
      await prisma.bcVendor.update({
        where: { vendorNo: v.vendorNo },
        data:  {
          resolvedCountry: code,
          resolvedBy:      "ai",
          resolvedNote:    String(a?.note ?? "").slice(0, 200) || null,
          resolvedAt:      new Date(),
        },
      })
      written++
    }

    return NextResponse.json({
      ok: true,
      done: todo.length <= BATCH,
      considered: batch.length,
      written,
      refused,
      remaining: Math.max(0, todo.length - batch.length),
    })
  } catch (e: any) {
    console.error("vendor resolve error:", e)
    return NextResponse.json({ error: e?.message ?? "Could not work out the countries" }, { status: 500 })
  }
}

// DELETE — clear every country the assistant worked out, leaving anything set by hand.
export async function DELETE() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const r = await prisma.bcVendor.updateMany({
      where: { resolvedBy: "ai" },
      data:  { resolvedCountry: null, resolvedBy: null, resolvedNote: null, resolvedAt: null },
    })
    return NextResponse.json({ ok: true, cleared: r.count })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Could not clear" }, { status: 500 })
  }
}

// PATCH — set one vendor's country by hand, or clear it with country: null.
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { vendorNo, country } = await req.json()
    const no = String(vendorNo ?? "").trim()
    if (!no) return NextResponse.json({ error: "No vendor given" }, { status: 400 })

    const code = String(country ?? "").trim().toUpperCase()
    if (code && !COUNTRY_NAMES[code]) {
      return NextResponse.json({ error: `${code} is not a country code we know` }, { status: 400 })
    }
    await prisma.bcVendor.update({
      where: { vendorNo: no },
      data:  code
        ? { resolvedCountry: code, resolvedBy: "manual", resolvedNote: "Set by hand", resolvedAt: new Date() }
        : { resolvedCountry: null, resolvedBy: null, resolvedNote: null, resolvedAt: null },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Could not save" }, { status: 500 })
  }
}
