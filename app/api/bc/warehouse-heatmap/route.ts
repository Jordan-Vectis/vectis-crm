import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress, bcPage } from "@/lib/bc"
import LOCATIONS from "@/lib/warehouse-locations.json"

export const maxDuration = 120

function enc(obj: object) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n")
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
      // ── Stage 1: Fetch all totes ─────────────────────────────────────────────
      await writer.write(enc({ type: "stage", label: "Fetching totes from BC…", stage: 1, stages: 2 }))

      const toteRows = await bcFetchAllWithProgress(
        token,
        "Receipt_Totes_Excel",
        undefined,
        undefined,
        500,
        (done, total) => {
          writer.write(enc({ type: "progress", done, total, stage: 1, label: "Fetching totes…" }))
        },
      )

      // Build tote info map
      const toteInfo = new Map<string, { description: string; category: string; catalogued: boolean }>()
      for (const r of toteRows) {
        const id = String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()
        if (id) {
          toteInfo.set(id, {
            description: String(r["Description"] ?? r["EVA_TOT_Description"] ?? "").trim(),
            category:    String(r["EVA_TOT_ArticleCategory"] ?? "").trim(),
            catalogued:  r["EVA_TOT_Catalogued"] === true,
          })
        }
      }

      const toteIds = [...toteInfo.keys()]

      // ── Stage 2: Get current location for each tote — same approach as
      //   Location History tab: Field_Caption eq 'Location' filtered by
      //   Primary_Key_Field_1_Value, batched with OR conditions. ───────────────
      await writer.write(enc({ type: "stage", label: "Fetching tote locations from BC…", stage: 2, stages: 2 }))

      const toteLocation = new Map<string, string>() // toteId → current location
      const BATCH_SIZE = 40 // tote IDs per OR-filter query
      const total = toteIds.length

      for (let i = 0; i < toteIds.length; i += BATCH_SIZE) {
        const batch  = toteIds.slice(i, i + BATCH_SIZE)
        const orPart = batch.map(id => `Primary_Key_Field_1_Value eq '${id}'`).join(" or ")
        const filter = `Field_Caption eq 'Location' and (${orPart})`

        try {
          const rows = await bcPage(token, "ChangeLogEntries", {
            $filter:  filter,
            $select:  "Primary_Key_Field_1_Value,New_Value,Date_and_Time",
            $orderby: "Date_and_Time desc",
            $top:     500,
          })

          // rows are newest-first — take the first entry per tote ID
          for (const r of rows) {
            const id  = String(r.Primary_Key_Field_1_Value ?? "").trim()
            const loc = String(r.New_Value ?? "").trim()
            if (id && !toteLocation.has(id)) {
              toteLocation.set(id, loc)
            }
          }
        } catch { /* skip failed batch — totes will appear as unlocated */ }

        const done = Math.min(i + BATCH_SIZE, total)
        await writer.write(enc({ type: "progress", done, total, label: "Locating totes…" }))
      }

      // ── Stage 3: Build result using static location list as scaffold ─────────
      const locationItems = new Map<string, { id: string; description: string; category: string; catalogued: boolean }[]>()

      for (const toteId of toteIds) {
        const loc  = toteLocation.get(toteId) ?? ""
        const info = toteInfo.get(toteId)!
        const key  = loc || "__UNLOCATED__"
        if (!locationItems.has(key)) locationItems.set(key, [])
        locationItems.get(key)!.push({ id: toteId, ...info })
      }

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
        // Any location from BC not in the static list
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
            totalLocations:    LOCATIONS.length,
            occupiedLocations: locations.filter(l => l.total > 0).length,
            matchedTotes:      toteLocation.size,
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
