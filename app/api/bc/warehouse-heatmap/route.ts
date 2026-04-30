import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import LOCATIONS from "@/lib/warehouse-locations.json"

export const maxDuration = 120

function enc(obj: object) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n")
}

async function getLatestLocation(
  token: string,
  keyField: string,
  keyValue: string,
  fieldCaption: string,
): Promise<string> {
  try {
    const rows = await bcPage(token, "ChangeLogEntries", {
      $filter:  `${keyField} eq '${keyValue}' and Field_Caption eq '${fieldCaption}'`,
      $select:  "New_Value,Date_and_Time",
      $orderby: "Date_and_Time desc",
      $top:     1,
    })
    return String(rows[0]?.New_Value ?? "").trim()
  } catch {
    return ""
  }
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
      // ── Stage 1: Fetch totes from BC ─────────────────────────────────────────
      await writer.write(enc({ type: "stage", label: "Fetching totes from BC…", stage: 1, stages: 3 }))

      const toteRows = await bcFetchAllWithProgress(
        token, "Receipt_Totes_Excel", undefined, undefined, 500,
        (done, total) => writer.write(enc({ type: "progress", done, total, label: "Fetching totes…" })),
      )

      // Detect ID field from first row
      const sampleTote = toteRows[0] ?? {}
      const toteIdField = ["No_", "EVA_TOT_No", "No", "ToteNo", "Tote_No", "Code"].find(f => f in sampleTote) ?? null
      const rawToteFields = Object.keys(sampleTote)

      type Item = { id: string; description: string; category: string; catalogued: boolean; type: "tote" | "barcode" }

      const totes: Item[] = []
      for (const r of toteRows) {
        const id = toteIdField ? String(r[toteIdField] ?? "").trim() : ""
        if (id) totes.push({
          id,
          description: String(r["Description"] ?? r["EVA_TOT_Description"] ?? "").trim(),
          category:    String(r["EVA_TOT_ArticleCategory"] ?? "").trim(),
          catalogued:  r["EVA_TOT_Catalogued"] === true,
          type:        "tote",
        })
      }

      // ── Stage 2: Fetch barcodes from DB ──────────────────────────────────────
      await writer.write(enc({ type: "stage", label: "Fetching barcodes…", stage: 2, stages: 3 }))

      const lotRows = await prisma.catalogueLot.findMany({
        where:  { barcode: { not: null } },
        select: { barcode: true, title: true, lotNumber: true, status: true },
      })

      const barcodes: Item[] = []
      for (const l of lotRows) {
        if (l.barcode) barcodes.push({
          id:          l.barcode,
          description: l.title,
          category:    l.lotNumber,
          catalogued:  l.status !== "ENTERED",
          type:        "barcode",
        })
      }

      await writer.write(enc({ type: "progress", done: barcodes.length, total: barcodes.length, label: `${barcodes.length} barcodes loaded` }))

      // ── Stage 3: Look up current location for each item ───────────────────────
      // Totes:    Primary_Key_Field_1_Value eq '{id}'   and Field_Caption eq 'Location'
      // Barcodes: Primary_Key_Field_2_Value eq '{id}'   and Field_Caption eq 'Article Location Code'
      // (Same queries as Location History tab)
      await writer.write(enc({ type: "stage", label: "Looking up locations in BC…", stage: 3, stages: 3 }))

      const PARALLEL    = 20
      const locationMap = new Map<string, string>() // item id → location

      const allItems = [...totes, ...barcodes]
      for (let i = 0; i < allItems.length; i += PARALLEL) {
        const batch = allItems.slice(i, i + PARALLEL)
        await Promise.all(batch.map(async item => {
          const loc = item.type === "tote"
            ? await getLatestLocation(token, "Primary_Key_Field_1_Value", item.id, "Location")
            : await getLatestLocation(token, "Primary_Key_Field_2_Value", item.id, "Article Location Code")
          if (loc) locationMap.set(item.id, loc)
        }))
        await writer.write(enc({ type: "progress", done: Math.min(i + PARALLEL, allItems.length), total: allItems.length, label: "Looking up locations…" }))
      }

      // ── Build result ─────────────────────────────────────────────────────────
      const locationItems = new Map<string, Item[]>()
      for (const item of allItems) {
        const loc = locationMap.get(item.id) ?? ""
        const key = loc || "__UNLOCATED__"
        if (!locationItems.has(key)) locationItems.set(key, [])
        locationItems.get(key)!.push(item)
      }

      const unlocatedItems = locationItems.get("__UNLOCATED__") ?? []
      locationItems.delete("__UNLOCATED__")

      const usedCodes = new Set<string>()
      const locations = [
        ...LOCATIONS.map((loc: any) => {
          const items = locationItems.get(loc.code) ?? []
          usedCodes.add(loc.code)
          return { code: loc.code, name: loc.name, total: items.length, catalogued: items.filter(i => i.catalogued).length, uncatalogued: items.filter(i => !i.catalogued).length, items }
        }),
        ...[...locationItems.entries()].filter(([code]) => !usedCodes.has(code)).map(([code, items]) => ({
          code, name: code, total: items.length, catalogued: items.filter(i => i.catalogued).length, uncatalogued: items.filter(i => !i.catalogued).length, items,
        })),
      ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))

      await writer.write(enc({
        type: "result",
        data: {
          locations,
          unlocated: {
            code: "UNLOCATED", name: "No Location",
            total: unlocatedItems.length,
            catalogued: unlocatedItems.filter(i => i.catalogued).length,
            uncatalogued: unlocatedItems.filter(i => !i.catalogued).length,
            items: unlocatedItems,
          },
          meta: {
            totalTotes:        totes.length,
            totalBarcodes:     barcodes.length,
            totalLocations:    LOCATIONS.length,
            occupiedLocations: locations.filter(l => l.total > 0).length,
            matchedItems:      locationMap.size,
            // Debug: raw field names from BC tote record
            toteIdField,
            rawToteFields,
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
