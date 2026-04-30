import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import LOCATIONS from "@/lib/warehouse-locations.json"

export const maxDuration = 120

function enc(obj: object) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n")
}

// Batch a list of IDs into OR-filter BC queries and return the latest
// location per ID from ChangeLogEntries.
async function batchLocations(
  token: string,
  ids: string[],
  keyField: "Primary_Key_Field_1_Value" | "Primary_Key_Field_2_Value",
  fieldCaption: string,
  batchSize = 40,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> {
  const locationMap = new Map<string, string>()
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch  = ids.slice(i, i + batchSize)
    const orPart = batch.map(id => `${keyField} eq '${id}'`).join(" or ")
    const filter = `Field_Caption eq '${fieldCaption}' and (${orPart})`
    try {
      const rows = await bcPage(token, "ChangeLogEntries", {
        $filter:  filter,
        $select:  `Primary_Key_Field_1_Value,Primary_Key_Field_2_Value,New_Value,Date_and_Time`,
        $orderby: "Date_and_Time desc",
        $top:     500,
      })
      // rows are newest-first — record the first (latest) location per id
      for (const r of rows) {
        const id  = String(r[keyField] ?? "").trim()
        const loc = String(r.New_Value ?? "").trim()
        if (id && !locationMap.has(id)) locationMap.set(id, loc)
      }
    } catch { /* skip failed batch */ }
    onProgress?.(Math.min(i + batchSize, ids.length), ids.length)
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
      // ── Stage 1: Fetch totes from BC + barcodes from DB in parallel ──────────
      await writer.write(enc({ type: "stage", label: "Fetching totes and barcodes…", stage: 1, stages: 3 }))

      const [toteRows, lotRows] = await Promise.all([
        bcFetchAllWithProgress(token, "Receipt_Totes_Excel", undefined, undefined, 500, (done, total) => {
          writer.write(enc({ type: "progress", done, total, stage: 1, label: "Fetching totes…" }))
        }),
        prisma.catalogueLot.findMany({
          where:  { barcode: { not: null } },
          select: { barcode: true, title: true, lotNumber: true, status: true },
        }),
      ])

      // Tote info map
      const toteInfo = new Map<string, { description: string; category: string; catalogued: boolean; type: "tote" }>()
      for (const r of toteRows) {
        const id = String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()
        if (id) toteInfo.set(id, {
          description: String(r["Description"] ?? r["EVA_TOT_Description"] ?? "").trim(),
          category:    String(r["EVA_TOT_ArticleCategory"] ?? "").trim(),
          catalogued:  r["EVA_TOT_Catalogued"] === true,
          type:        "tote",
        })
      }

      // Barcode info map
      const barcodeInfo = new Map<string, { description: string; category: string; catalogued: boolean; type: "barcode" }>()
      for (const l of lotRows) {
        if (l.barcode) barcodeInfo.set(l.barcode, {
          description: l.title,
          category:    l.lotNumber,
          catalogued:  l.status !== "ENTERED",
          type:        "barcode",
        })
      }

      const toteIds    = [...toteInfo.keys()]
      const barcodeIds = [...barcodeInfo.keys()]

      // ── Stage 2: Locate totes via Field_Caption eq 'Location' ────────────────
      // (same approach as Location History tab for totes)
      await writer.write(enc({ type: "stage", label: "Locating totes in BC…", stage: 2, stages: 3 }))

      const toteLocation = await batchLocations(
        token, toteIds, "Primary_Key_Field_1_Value", "Location", 40,
        (done, total) => writer.write(enc({ type: "progress", done, total, stage: 2, label: "Locating totes…" })),
      )

      // ── Stage 3: Locate barcodes via Field_Caption eq 'Article Location Code' ─
      // (same approach as Location History tab for barcodes)
      await writer.write(enc({ type: "stage", label: "Locating barcoded items in BC…", stage: 3, stages: 3 }))

      const barcodeLocation = await batchLocations(
        token, barcodeIds, "Primary_Key_Field_2_Value", "Article Location Code", 40,
        (done, total) => writer.write(enc({ type: "progress", done, total, stage: 3, label: "Locating barcodes…" })),
      )

      // ── Build result ─────────────────────────────────────────────────────────
      type Item = { id: string; description: string; category: string; catalogued: boolean; type: "tote" | "barcode" }
      const locationItems = new Map<string, Item[]>()

      function place(id: string, info: Omit<Item, "id">, loc: string) {
        const key = loc || "__UNLOCATED__"
        if (!locationItems.has(key)) locationItems.set(key, [])
        locationItems.get(key)!.push({ id, ...info })
      }

      for (const id of toteIds)    place(id, toteInfo.get(id)!,    toteLocation.get(id) ?? "")
      for (const id of barcodeIds) place(id, barcodeInfo.get(id)!, barcodeLocation.get(id) ?? "")

      const unlocatedItems = locationItems.get("__UNLOCATED__") ?? []
      locationItems.delete("__UNLOCATED__")

      const usedCodes = new Set<string>()

      const locations = [
        ...LOCATIONS.map((loc: any) => {
          const items = locationItems.get(loc.code) ?? []
          usedCodes.add(loc.code)
          return {
            code:         loc.code,
            name:         loc.name,
            total:        items.length,
            catalogued:   items.filter(i => i.catalogued).length,
            uncatalogued: items.filter(i => !i.catalogued).length,
            items,
          }
        }),
        ...[...locationItems.entries()]
          .filter(([code]) => !usedCodes.has(code))
          .map(([code, items]) => ({
            code,
            name:         code,
            total:        items.length,
            catalogued:   items.filter(i => i.catalogued).length,
            uncatalogued: items.filter(i => !i.catalogued).length,
            items,
          })),
      ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))

      await writer.write(enc({
        type: "result",
        data: {
          locations,
          unlocated: {
            code: "UNLOCATED",
            name: "No Location",
            total:        unlocatedItems.length,
            catalogued:   unlocatedItems.filter(i => i.catalogued).length,
            uncatalogued: unlocatedItems.filter(i => !i.catalogued).length,
            items: unlocatedItems,
          },
          meta: {
            totalTotes:        toteIds.length,
            totalBarcodes:     barcodeIds.length,
            totalLocations:    LOCATIONS.length,
            occupiedLocations: locations.filter(l => l.total > 0).length,
            matchedTotes:      toteLocation.size,
            matchedBarcodes:   barcodeLocation.size,
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
