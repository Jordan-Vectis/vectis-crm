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
      // ── Stage 1: Fetch all totes from BC ────────────────────────────────────
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

      // Build a tote lookup: toteNo → { description, category, catalogued }
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

      // ── Stage 2: Read current location for each tote via ChangeLogEntries ───
      // Strategy: read ChangeLogEntries with Field_Caption eq 'Location' newest-
      // first and track the LATEST location per Primary_Key_Field_1_Value.
      // We don't filter by tote ID here — we collect ALL location changes and
      // then match against our tote set.  If a tote ID appears in both
      // Receipt_Totes_Excel and ChangeLogEntries it will be placed on the map;
      // if not we try matching by stripping/normalising the key.
      await writer.write(enc({ type: "stage", label: "Reading current tote locations from BC…", stage: 2, stages: 2 }))

      // location code → list of tote items placed there
      const locationItems = new Map<string, { id: string; description: string; category: string; catalogued: boolean }[]>()

      // We also track "latest location per BC key" from change log
      const latestLocation = new Map<string, string>() // bcKey → locationCode
      const BATCH     = 500
      const MAX_PAGES = 60  // up to 30 000 entries

      let skip = 0
      let foundAny = false

      for (let page = 0; page < MAX_PAGES; page++) {
        let rows: any[]
        try {
          rows = await bcPage(token, "ChangeLogEntries", {
            $filter:  `Field_Caption eq 'Location'`,
            $select:  "Primary_Key_Field_1_Value,New_Value,Date_and_Time",
            $orderby: "Date_and_Time desc",
            $top:     BATCH,
            $skip:    skip,
          })
        } catch (err: any) {
          await writer.write(enc({ type: "stage", label: `Warning: ${err.message} — partial data`, stage: 2, stages: 2 }))
          break
        }

        if (rows.length === 0) break

        for (const r of rows) {
          const key = String(r.Primary_Key_Field_1_Value ?? "").trim()
          const loc = String(r.New_Value ?? "").trim()
          // Record only the FIRST (newest) location we see for each key
          if (key && !latestLocation.has(key)) {
            latestLocation.set(key, loc)
          }
        }

        const pct = Math.round(((page + 1) / MAX_PAGES) * 100)
        await writer.write(enc({ type: "progress", done: page + 1, total: MAX_PAGES, label: `Reading location history… (page ${page + 1})` }))

        if (rows.length < BATCH) break
        skip += BATCH
      }

      // Now match ChangeLogEntries keys to tote IDs from Receipt_Totes_Excel.
      // We try exact match first, then case-insensitive, then normalised (spaces→nothing).
      const toteIds    = [...toteInfo.keys()]
      const toteIdSet  = new Set(toteIds)
      const toteIdLower = new Map(toteIds.map(id => [id.toLowerCase(), id]))

      const toteLocation = new Map<string, string>() // toteId → locationCode

      for (const [bcKey, loc] of latestLocation) {
        // 1. Exact match
        if (toteIdSet.has(bcKey)) {
          toteLocation.set(bcKey, loc)
          foundAny = true
          continue
        }
        // 2. Case-insensitive
        const lower = bcKey.toLowerCase()
        if (toteIdLower.has(lower)) {
          toteLocation.set(toteIdLower.get(lower)!, loc)
          foundAny = true
          continue
        }
        // 3. Normalised (strip non-alphanumeric)
        const norm = bcKey.replace(/[^a-z0-9]/gi, "").toLowerCase()
        for (const [tid, orig] of toteIdLower) {
          if (tid.replace(/[^a-z0-9]/gi, "") === norm) {
            toteLocation.set(orig, loc)
            foundAny = true
            break
          }
        }
      }

      // ── Stage 3: Build result using static location list as scaffold ─────────
      // Build location → items map from matched totes
      for (const toteId of toteIds) {
        const loc  = toteLocation.get(toteId) ?? ""
        const info = toteInfo.get(toteId)!
        const key  = loc || "__UNLOCATED__"
        if (!locationItems.has(key)) locationItems.set(key, [])
        locationItems.get(key)!.push({ id: toteId, ...info })
      }

      const unlocatedItems = locationItems.get("__UNLOCATED__") ?? []
      locationItems.delete("__UNLOCATED__")

      // Merge with static location list — every known location appears in
      // the result even if empty, so the map always shows the full warehouse.
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
        // Totes placed in a location that isn't in our static list
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
            foundAny,
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
