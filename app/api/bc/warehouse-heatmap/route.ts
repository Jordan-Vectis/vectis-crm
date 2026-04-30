import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress, bcPage } from "@/lib/bc"

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

      // Try to detect a direct location field on the tote record
      const LOCATION_FIELD_CANDIDATES = [
        "EVA_TOT_Location", "EVA_TOT_LocationCode", "EVA_TOT_Location_Code",
        "Location", "Location_Code", "Bin_Code", "EVA_TOT_BinCode",
      ]
      const sampleRow = toteRows[0] ?? {}
      const directLocationField = LOCATION_FIELD_CANDIDATES.find(f => f in sampleRow) ?? null

      // ── Stage 2: Build tote → current location map ───────────────────────────
      const toteLocation = new Map<string, string>()
      for (const r of toteRows) {
        const id = String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()
        if (id) toteLocation.set(id, directLocationField ? String(r[directLocationField] ?? "").trim() : "")
      }

      if (!directLocationField) {
        await writer.write(enc({ type: "stage", label: "Fetching location history…", stage: 2, stages: 2 }))

        // Fetch ChangeLogEntries ordered newest-first and stop as soon as every
        // tote has a location recorded — avoids scanning the entire history.
        const pending = new Set(toteLocation.keys())
        const SELECT  = "Primary_Key_Field_1_Value,New_Value,Date_and_Time"
        const BATCH   = 500
        const MAX_PAGES = 40  // hard safety cap (40 × 500 = 20 000 entries)
        let skip = 0

        for (let page = 0; page < MAX_PAGES && pending.size > 0; page++) {
          let rows: any[]
          try {
            rows = await bcPage(token, "ChangeLogEntries", {
              $filter:  `Field_Caption eq 'Location'`,
              $select:  SELECT,
              $orderby: "Date_and_Time desc",
              $top:     BATCH,
              $skip:    skip,
            })
          } catch (err: any) {
            // Emit a warning but continue — we may have partial data
            await writer.write(enc({ type: "stage", label: `Location history: ${err.message ?? "error"} — showing partial data`, stage: 2, stages: 2 }))
            break
          }

          for (const r of rows) {
            const id  = String(r.Primary_Key_Field_1_Value ?? "").trim()
            const loc = String(r.New_Value ?? "").trim()
            if (pending.has(id)) {
              toteLocation.set(id, loc)
              pending.delete(id)
            }
          }

          const located = toteRows.length - pending.size
          await writer.write(enc({ type: "progress", done: located, total: toteRows.length, stage: 2, label: "Matching tote locations…" }))

          if (rows.length < BATCH) break  // no more entries
          skip += BATCH
        }
      }

      // ── Stage 3: Build result ────────────────────────────────────────────────
      const CAT_COL    = "EVA_TOT_ArticleCategory"
      const CATALOGUED = "EVA_TOT_Catalogued"

      const totes = toteRows.map(r => ({
        id:          String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim(),
        description: String(r["Description"] ?? r["EVA_TOT_Description"] ?? "").trim(),
        category:    String(r[CAT_COL] ?? "").trim(),
        catalogued:  r[CATALOGUED] === true,
        location:    toteLocation.get(String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()) ?? "",
      }))

      const locationMap = new Map<string, typeof totes>()
      for (const t of totes) {
        const key = t.location || "__UNLOCATED__"
        if (!locationMap.has(key)) locationMap.set(key, [])
        locationMap.get(key)!.push(t)
      }

      const unlocatedItems = locationMap.get("__UNLOCATED__") ?? []
      locationMap.delete("__UNLOCATED__")

      const locations = [...locationMap.entries()]
        .map(([code, items]) => ({
          code,
          total:        items.length,
          catalogued:   items.filter(i => i.catalogued).length,
          uncatalogued: items.filter(i => !i.catalogued).length,
          items,
        }))
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))

      await writer.write(enc({
        type: "result",
        data: {
          locations,
          unlocated: {
            code: "UNLOCATED",
            total:        unlocatedItems.length,
            catalogued:   unlocatedItems.filter(i => i.catalogued).length,
            uncatalogued: unlocatedItems.filter(i => !i.catalogued).length,
            items: unlocatedItems,
          },
          meta: {
            totalTotes:        totes.length,
            totalLocations:    locationMap.size,
            occupiedLocations: locations.filter(l => l.total > 0).length,
            directField:       directLocationField,
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
