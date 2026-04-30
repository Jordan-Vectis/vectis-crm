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
    let closed = false
    async function safeWrite(obj: object) {
      if (closed) return
      try { await writer.write(enc(obj)) } catch { closed = true }
    }

    try {
      // ── Stage 1: Fetch all auction receipt lines from BC ─────────────────────
      await safeWrite({ type: "stage", label: "Fetching auction lines from BC…" })

      const lines = await bcFetchAllWithProgress(
        token,
        "Auction_Receipt_Lines_Excel",
        undefined,
        undefined,
        500,
        (done, total) => {
          safeWrite({ type: "progress", done, total, label: "Fetching auction lines…", found: done, scanned: done })
        },
      )

      if (lines.length === 0) {
        await writer.write(enc({ type: "result", data: [] }))
        return
      }

      // Log available field names from first row to aid debugging
      const fields = Object.keys(lines[0])

      // Detect key fields — inspect first row to find auction, lot, barcode, location
      const sample = lines[0]

      // Try to find field names by pattern matching
      function findField(row: Record<string, any>, candidates: string[]): string | null {
        return candidates.find(c => c in row) ?? null
      }

      const auctionField   = findField(sample, ["EVA_ARL_AuctionCode", "Auction_Code", "AuctionCode", "Sale_Code", "SaleCode", "EVA_ARL_SaleCode"])
      const auctionName    = findField(sample, ["EVA_ARL_AuctionName", "Auction_Name", "AuctionName", "Sale_Name"])
      const auctionDate    = findField(sample, ["EVA_ARL_AuctionDate", "Auction_Date", "AuctionDate", "Sale_Date"])
      const lotNoField     = findField(sample, ["EVA_ARL_LotNo", "Lot_No", "LotNo", "Lot_Number", "LotNumber"])
      const barcodeField   = findField(sample, ["EVA_ARL_InternalBarcode", "Internal_Barcode", "Barcode", "EVA_ARL_Barcode", "InternalBarcode"])
      const titleField     = findField(sample, ["EVA_ARL_Description", "Description", "Title", "EVA_ARL_Title", "Lot_Description"])
      const locationField  = findField(sample, ["EVA_ARL_ArticleLocationCode", "Article_Location_Code", "Location_Code", "LocationCode", "Location"])

      // ── Stage 2: Check location for each lot via ChangeLogEntries ────────────
      // Only needed if there's no direct location field on the line.
      // Uses same approach as Location History: Primary_Key_Field_2_Value eq '{barcode}' and Field_Caption eq 'Article Location Code'

      const barcodes = lines
        .map(l => barcodeField ? String(l[barcodeField] ?? "").trim() : "")
        .filter(Boolean)

      const locationMap = new Map<string, string>() // barcode → current location

      if (locationField) {
        // Location is directly on the line record — no BC query needed
        for (const l of lines) {
          const barcode = barcodeField ? String(l[barcodeField] ?? "").trim() : ""
          const loc     = String(l[locationField] ?? "").trim()
          if (barcode && loc) locationMap.set(barcode, loc)
        }
      } else {
        // Look up location via ChangeLogEntries — same query as Location History tab
        if (closed) return
      await safeWrite({ type: "stage", label: "Fetching BC item locations…" })

        const uniqueBarcodes = [...new Set(barcodes)]
        const PARALLEL = 20

        for (let i = 0; i < uniqueBarcodes.length; i += PARALLEL) {
          const batch = uniqueBarcodes.slice(i, i + PARALLEL)
          await Promise.all(batch.map(async barcode => {
            try {
              const rows = await bcPage(token, "ChangeLogEntries", {
                $filter:  `Primary_Key_Field_2_Value eq '${barcode}' and Field_Caption eq 'Article Location Code'`,
                $select:  "New_Value,Date_and_Time",
                $orderby: "Date_and_Time desc",
                $top:     1,
              })
              const loc = String(rows[0]?.New_Value ?? "").trim()
              if (loc) locationMap.set(barcode, loc)
            } catch { /* skip */ }
          }))
          const locatedSoFar = locationMap.size
          await safeWrite({
            type:    "progress",
            done:    Math.min(i + PARALLEL, uniqueBarcodes.length),
            total:   uniqueBarcodes.length,
            label:   `Locating items… ${locatedSoFar} of ${uniqueBarcodes.length} found`,
            found:   locatedSoFar,
            page:    Math.ceil((i + PARALLEL) / PARALLEL),
            scanned: Math.min(i + PARALLEL, uniqueBarcodes.length),
          })
        }
      }

      // ── Stage 3: Group lines by auction and attach locations ─────────────────
      const auctionMap = new Map<string, {
        code: string; name: string; date: string | null
        lots: { lotNumber: string; barcode: string; title: string; location: string | null }[]
      }>()

      for (const l of lines) {
        const code    = auctionField  ? String(l[auctionField]  ?? "").trim() : "UNKNOWN"
        const name    = auctionName   ? String(l[auctionName]   ?? "").trim() : code
        const date    = auctionDate   ? String(l[auctionDate]   ?? "").trim() : null
        const lotNo   = lotNoField    ? String(l[lotNoField]    ?? "").trim() : ""
        const barcode = barcodeField  ? String(l[barcodeField]  ?? "").trim() : ""
        const title   = titleField    ? String(l[titleField]    ?? "").trim() : ""
        const location = barcode ? (locationMap.get(barcode) ?? null) : null

        if (!auctionMap.has(code)) {
          auctionMap.set(code, { code, name, date, lots: [] })
        }
        auctionMap.get(code)!.lots.push({ lotNumber: lotNo, barcode, title, location })
      }

      const result = [...auctionMap.values()]
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))

      await safeWrite({ type: "result", data: { auctions: result, fields } })
    } catch (err: any) {
      await safeWrite({ type: "error", message: err.message ?? "Unknown error" })
    } finally {
      try { await writer.close() } catch { /* already closed */ }
    }
  })()

  return new NextResponse(stream.readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  })
}
