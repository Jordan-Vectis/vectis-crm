import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import * as XLSX from "xlsx"
import { computeVendorLocations } from "@/lib/vendor-locations"

export const maxDuration = 120

// GET /api/bc/vendor-locations/excel
// The Vendor Locations report as a workbook. Four sheets: by country, the vendors we could not
// place, how each country was decided, and every vendor with the country it was given and why.
//
// ⚠ Same figures as the screen and the PDF — all three call computeVendorLocations().
//
// ⚠ The spreadsheet carries EVERY unplaced vendor, not the 500 the screen shows, because this is
// the copy someone works through to put them right.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const d = await computeVendorLocations(
      { from: searchParams.get("from"), to: searchParams.get("to"), basis: (searchParams.get("basis") as any) || null },
      { detail: true },
    )
    const wb = XLSX.utils.book_new()

    // ── Sheet 1: by country ──────────────────────────────────────────────────
    const byCountry = d.rows.map(r => ({
      "Country":            r.name,
      "Code":               r.code === "??" ? "" : r.code,
      "Vendors":            r.vendors,
      "Vendors %":          r.vendorPct,
      "Receipts":           r.receipts,
      "Receipts %":         r.receiptPct,
      "Lots":               r.lots,
      "Lots %":             r.lotPct,
      "Lots per vendor":    r.vendors ? Math.round(r.lots / r.vendors) : "",
      "Lots per receipt":   r.receipts ? Math.round(r.lots / r.receipts) : "",
      "Country worked out from the address": r.worked || "",
      "No address in BC":   r.noAddress || "",
    }))
    byCountry.push({
      "Country": "TOTAL", "Code": "",
      "Vendors": d.totals.vendors, "Vendors %": 100,
      "Receipts": d.totals.receipts, "Receipts %": 100,
      "Lots": d.totals.lots, "Lots %": 100,
      "Lots per vendor": d.totals.vendors ? Math.round(d.totals.lots / d.totals.vendors) : "",
      "Lots per receipt": d.totals.receipts ? Math.round(d.totals.lots / d.totals.receipts) : "",
      "Country worked out from the address": d.totals.workedOut,
      "No address in BC": d.totals.noAddress,
    } as any)
    const s1 = XLSX.utils.json_to_sheet(byCountry)
    s1["!cols"] = [{ wch: 26 }, { wch: 6 }, { wch: 9 }, { wch: 10 }, { wch: 9 }, { wch: 11 }, { wch: 10 }, { wch: 8 }, { wch: 15 }, { wch: 16 }, { wch: 34 }, { wch: 17 }]
    XLSX.utils.book_append_sheet(wb, s1, "By country")

    // ── Sheet 2: the ones we could not place ─────────────────────────────────
    const leftovers = d.unknownSample.map(u => ({
      "Vendor":   u.vendorNo,
      "Name":     u.name ?? "",
      "Town":     u.city ?? "",
      "County":   u.county ?? "",
      "Postcode": u.postCode ?? "",
      "Why":      u.hasAddress ? "Address could not be matched to a country" : "No address in Business Central",
    }))
    const s2 = XLSX.utils.json_to_sheet(leftovers.length ? leftovers : [{ Vendor: "", Name: "Every vendor was placed", Town: "", County: "", Postcode: "", Why: "" }])
    s2["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 42 }]
    XLSX.utils.book_append_sheet(wb, s2, "Not placed")

    // ── Sheet 3: how it was decided ──────────────────────────────────────────
    const s3 = XLSX.utils.json_to_sheet([
      { "How the country was decided": "Period", "Vendors": (d.range.from || d.range.to ? `${d.range.basis === "auction" ? "Sold" : d.range.basis === "catalogued" ? "Catalogued" : "Goods received"} ${d.range.from ?? "start"} to ${d.range.to ?? "today"}` : "Everything we hold") as any },
      ...(d.undated ? [{ "How the country was decided": "Lots with no date of that kind in BC (not in a dated report)", "Vendors": d.undated }] : []),
      ...d.reasons.map(r => ({ "How the country was decided": r.reason, "Vendors": r.count })),
      { "How the country was decided": "Could not be decided", "Vendors": d.totals.unknown },
    ])
    s3["!cols"] = [{ wch: 38 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, s3, "How it was decided")

    // ── Sheet 4: every vendor, with the country it was given and why ─────────
    // ⚠ This is the sheet for checking the figures rather than taking them on trust. Sort or filter
    // it on Country or on Why and you can see exactly which vendors made up each row of sheet 1.
    const everyone = (d.detail ?? []).map(v => ({
      "Vendor":   v.vendorNo,
      "Name":     v.name ?? "",
      "Country":  v.country,
      "Code":     v.code,
      "Why":      v.reason,
      "Town":     v.city ?? "",
      "County":   v.county ?? "",
      "Postcode": v.postCode ?? "",
      "Receipts": v.receipts,
      "Lots":     v.lots,
    }))
    const s4 = XLSX.utils.json_to_sheet(everyone.length ? everyone : [{ Vendor: "", Name: "No vendors in this period", Country: "", Code: "", Why: "", Town: "", County: "", Postcode: "", Receipts: "", Lots: "" }])
    s4["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 20 }, { wch: 6 }, { wch: 32 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }]
    s4["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: everyone.length, c: 9 } }) }
    XLSX.utils.book_append_sheet(wb, s4, "Every vendor")

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
    const stamp = d.range.from || d.range.to ? `${d.range.from ?? "start"}_to_${d.range.to ?? "today"}` : new Date().toISOString().slice(0, 10)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="vendor-locations-${stamp}.xlsx"`,
        "Content-Length":      String(buf.length),
      },
    })
  } catch (e: any) {
    console.error("vendor-locations/excel error:", e)
    return NextResponse.json({ error: e?.message ?? "Export failed" }, { status: 500 })
  }
}
