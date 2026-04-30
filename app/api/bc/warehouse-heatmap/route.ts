import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"
import LOCATIONS from "@/lib/warehouse-locations.json"

export const maxDuration = 120

function enc(obj: object) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n")
}

const KNOWN_LOCATIONS = new Set(LOCATIONS.map((l: any) => l.code))

async function readChangeLog(
  token: string,
  fieldCaption: string,
  keyField: "Primary_Key_Field_1_Value" | "Primary_Key_Field_2_Value",
  onProgress: (found: number, page: number, scanning: number) => void,
): Promise<Map<string, string>> {
  const locationMap = new Map<string, string>()
  const BATCH = 500
  const MAX_PAGES = 100

  for (let page = 0; page < MAX_PAGES; page++) {
    // Emit BEFORE the fetch so user sees the page tick immediately
    onProgress(locationMap.size, page + 1, (page + 1) * BATCH)

    let rows: any[]
    try {
      rows = await bcPage(token, "ChangeLogEntries", {
        $filter:  `Field_Caption eq '${fieldCaption}'`,
        $select:  `Primary_Key_Field_1_Value,Primary_Key_Field_2_Value,New_Value,Date_and_Time`,
        $orderby: "Date_and_Time desc",
        $top:     BATCH,
        $skip:    page * BATCH,
      })
    } catch { break }

    if (rows.length === 0) break

    for (const r of rows) {
      const id  = String(r[keyField] ?? "").trim()
      const loc = String(r.New_Value ?? "").trim()
      if (id && !locationMap.has(id)) locationMap.set(id, loc)
    }

    // Emit AFTER the fetch with updated count
    onProgress(locationMap.size, page + 1, (page + 1) * BATCH)
    if (rows.length < BATCH) break
  }

  return locationMap
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  ;(async () => {
    try {
      // ── Stage 1: Read tote locations from change log ──────────────────────────
      // Field_Caption eq 'Location', Primary_Key_Field_1_Value = tote ID
      // Ordered newest-first — exactly how Location History works, just in bulk
      await writer.write(enc({ type: "stage", label: "Reading tote locations from BC…", stage: 1, stages: 2 }))

      const toteLocations = await readChangeLog(
        token, "Location", "Primary_Key_Field_1_Value",
        (found, page, scanned) => writer.write(enc({
          type: "progress", done: page, total: 100,
          label: `Page ${page} — ${found.toLocaleString()} totes found (${scanned.toLocaleString()} entries scanned)`,
          found, page, scanned,
        })),
      )

      // ── Stage 2: Read barcode locations from change log ───────────────────────
      await writer.write(enc({ type: "stage", label: "Reading barcode locations from BC…", stage: 2, stages: 2 }))

      const barcodeLocations = await readChangeLog(
        token, "Article Location Code", "Primary_Key_Field_2_Value",
        (found, page, scanned) => writer.write(enc({
          type: "progress", done: page, total: 100,
          label: `Page ${page} — ${found.toLocaleString()} barcodes found (${scanned.toLocaleString()} entries scanned)`,
          found, page, scanned,
        })),
      )

      // ── Build result ─────────────────────────────────────────────────────────
      type Item = { id: string; type: "tote" | "barcode" }
      const locationItems = new Map<string, Item[]>()

      function place(id: string, type: Item["type"], loc: string) {
        const key = loc || "__UNLOCATED__"
        if (!locationItems.has(key)) locationItems.set(key, [])
        locationItems.get(key)!.push({ id, type })
      }

      for (const [id, loc] of toteLocations)    place(id, "tote",    loc)
      for (const [id, loc] of barcodeLocations) place(id, "barcode", loc)

      const unlocatedItems = locationItems.get("__UNLOCATED__") ?? []
      locationItems.delete("__UNLOCATED__")

      const usedCodes = new Set<string>()
      const locations = [
        ...LOCATIONS.map((loc: any) => {
          const items = locationItems.get(loc.code) ?? []
          usedCodes.add(loc.code)
          return { code: loc.code, name: loc.name, total: items.length, totes: items.filter(i => i.type === "tote").length, barcodes: items.filter(i => i.type === "barcode").length, items }
        }),
        ...[...locationItems.entries()].filter(([code]) => !usedCodes.has(code)).map(([code, items]) => ({
          code, name: code, total: items.length, totes: items.filter(i => i.type === "tote").length, barcodes: items.filter(i => i.type === "barcode").length, items,
        })),
      ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))

      await writer.write(enc({
        type: "result",
        data: {
          locations,
          unlocated: {
            code: "UNLOCATED", name: "No Location",
            total: unlocatedItems.length,
            totes: unlocatedItems.filter(i => i.type === "tote").length,
            barcodes: unlocatedItems.filter(i => i.type === "barcode").length,
            items: unlocatedItems,
          },
          meta: {
            totalTotes:        toteLocations.size,
            totalBarcodes:     barcodeLocations.size,
            totalLocations:    LOCATIONS.length,
            occupiedLocations: locations.filter(l => l.total > 0).length,
          },
        },
      }))
    } catch (err: any) {
      await writer.write(enc({ type: "error", message: err.message ?? "Unknown error" }))
    } finally {
      await writer.close()
    }
  })()

  return new NextResponse(stream.readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  })
}
