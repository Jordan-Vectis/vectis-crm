import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

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
      // ── Stage 1: Fetch lots from our DB grouped by auction ───────────────────
      await writer.write(enc({ type: "stage", label: "Loading catalogue lots…" }))

      const auctions = await prisma.catalogueAuction.findMany({
        where: { complete: false },
        orderBy: { auctionDate: "desc" },
        select: {
          id: true, code: true, name: true, auctionDate: true, auctionType: true,
          lots: {
            select: { id: true, lotNumber: true, barcode: true, title: true, status: true },
            orderBy: { lotNumber: "asc" },
          },
        },
      })

      // Collect all barcodes from lots
      const allBarcodes = new Set<string>()
      for (const a of auctions) {
        for (const l of a.lots) {
          if (l.barcode) allBarcodes.add(l.barcode)
        }
      }

      await writer.write(enc({ type: "progress", done: auctions.length, total: auctions.length, label: `${auctions.length} auctions loaded` }))

      // ── Stage 2: Fetch BC item locations via change log ──────────────────────
      await writer.write(enc({ type: "stage", label: "Fetching BC item locations…" }))

      const barcodeLocation = new Map<string, string>() // barcode → current location
      const pending  = new Set(allBarcodes)
      const BATCH    = 500
      const MAX_PAGES = 40
      let skip = 0

      for (let page = 0; page < MAX_PAGES && pending.size > 0; page++) {
        let rows: any[]
        try {
          rows = await bcPage(token, "ChangeLogEntries", {
            $filter:  `Field_Caption eq 'Article Location Code'`,
            $select:  "Primary_Key_Field_1_Value,Primary_Key_Field_2_Value,New_Value,Date_and_Time",
            $orderby: "Date_and_Time desc",
            $top:     BATCH,
            $skip:    skip,
          })
        } catch { break }

        for (const r of rows) {
          // Primary_Key_Field_2_Value is the barcode for items
          const barcode = String(r.Primary_Key_Field_2_Value ?? r.Primary_Key_Field_1_Value ?? "").trim()
          const loc     = String(r.New_Value ?? "").trim()
          if (pending.has(barcode)) {
            barcodeLocation.set(barcode, loc)
            pending.delete(barcode)
          }
        }

        const located = allBarcodes.size - pending.size
        await writer.write(enc({ type: "progress", done: located, total: allBarcodes.size, label: "Matching lot locations…" }))

        if (rows.length < BATCH) break
        skip += BATCH
      }

      // ── Stage 3: Build result ────────────────────────────────────────────────
      const result = auctions.map(a => ({
        id:          a.id,
        code:        a.code,
        name:        a.name,
        auctionDate: a.auctionDate,
        auctionType: a.auctionType,
        lots: a.lots.map(l => ({
          id:        l.id,
          lotNumber: l.lotNumber,
          barcode:   l.barcode,
          title:     l.title,
          status:    l.status,
          location:  l.barcode ? (barcodeLocation.get(l.barcode) ?? null) : null,
        })),
      }))

      await writer.write(enc({ type: "result", data: result }))
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
