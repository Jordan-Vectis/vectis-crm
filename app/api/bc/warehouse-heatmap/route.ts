import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import LOCATIONS from "@/lib/warehouse-locations.json"

export const maxDuration = 120

function enc(obj: object) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n")
}

// Exactly the same query Location History uses, but $top=1 (we only need the latest)
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
      // ── Stage 1: Fetch totes from BC + barcodes from DB ──────────────────────
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

      type Item = { id: string; description: string; category: string; catalogued: boolean; type: "tote" | "barcode" }

      // Tote list
      const totes: Item[] = []
      for (const r of toteRows) {
        const id = String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()
        if (id) totes.push({
          id,
          description: String(r["Description"] ?? r["EVA_TOT_Description"] ?? "").trim(),
          category:    String(r["EVA_TOT_ArticleCategory"] ?? "").trim(),
          catalogued:  r["EVA_TOT_Catalogued"] === true,
          type:        "tote",
        })
      }

      // Barcode list
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

      // ── Stage 2: Look up current location for each tote ──────────────────────
      // Same query as Location History tab: Primary_Key_Field_1_Value eq '{id}' and Field_Caption eq 'Location'
      await writer.write(enc({ type: "stage", label: "Locating totes in BC…", stage: 2, stages: 3 }))

      const toteLocation = new Map<string, string>()
      const PARALLEL = 20

      for (let i = 0; i < totes.length; i += PARALLEL) {
        const batch = totes.slice(i, i + PARALLEL)
        await Promise.all(batch.map(async t => {
          const loc = await getLatestLocation(token, "Primary_Key_Field_1_Value", t.id, "Location")
          if (loc) toteLocation.set(t.id, loc)
        }))
        await writer.write(enc({ type: "progress", done: Math.min(i + PARALLEL, totes.length), total: totes.length, label: "Locating totes…" }))
      }

      // ── Stage 3: Look up current location for each barcode ───────────────────
      // Same query as Location History tab: Primary_Key_Field_2_Value eq '{barcode}' and Field_Caption eq 'Article Location Code'
      await writer.write(enc({ type: "stage", label: "Locating barcoded items in BC…", stage: 3, stages: 3 }))

      const barcodeLocation = new Map<string, string>()

      for (let i = 0; i < barcodes.length; i += PARALLEL) {
        const batch = barcodes.slice(i, i + PARALLEL)
        await Promise.all(batch.map(async b => {
          const loc = await getLatestLocation(token, "Primary_Key_Field_2_Value", b.id, "Article Location Code")
          if (loc) barcodeLocation.set(b.id, loc)
        }))
        await writer.write(enc({ type: "progress", done: Math.min(i + PARALLEL, barcodes.length), total: barcodes.length, label: "Locating barcodes…" }))
      }

      // ── Build result ─────────────────────────────────────────────────────────
      const locationItems = new Map<string, Item[]>()

      function place(item: Item, loc: string) {
        const key = loc || "__UNLOCATED__"
        if (!locationItems.has(key)) locationItems.set(key, [])
        locationItems.get(key)!.push(item)
      }

      for (const t of totes)    place(t, toteLocation.get(t.id) ?? "")
      for (const b of barcodes) place(b, barcodeLocation.get(b.id) ?? "")

      const unlocatedItems = locationItems.get("__UNLOCATED__") ?? []
      locationItems.delete("__UNLOCATED__")

      const usedCodes = new Set<string>()
      const locations = [
        ...LOCATIONS.map((loc: any) => {
          const items = locationItems.get(loc.code) ?? []
          usedCodes.add(loc.code)
          return { code: loc.code, name: loc.name, total: items.length, catalogued: items.filter(i => i.catalogued).length, uncatalogued: items.filter(i => !i.catalogued).length, items }
        }),
        ...[...locationItems.entries()]
          .filter(([code]) => !usedCodes.has(code))
          .map(([code, items]) => ({ code, name: code, total: items.length, catalogued: items.filter(i => i.catalogued).length, uncatalogued: items.filter(i => !i.catalogued).length, items })),
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
