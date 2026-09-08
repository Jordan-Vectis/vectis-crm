import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { PDFDocument, StandardFonts, PDFFont, PDFPage, PDFImage, rgb } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { computeVendorLocations, type VendorLocations } from "@/lib/vendor-locations"

export const maxDuration = 120
export const runtime = "nodejs"

// GET /api/bc/vendor-locations/pdf
// The Vendor Locations report as an A4 PDF.
//
// ⚠ pdf-lib, never pdfkit — pdfkit fails on Railway looking for Helvetica.afm.
// ⚠ Same figures as the screen and the spreadsheet: all three call computeVendorLocations().
// ⚠ Plain words throughout. This gets read by people who did not build it.

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const RIGHT  = PAGE_W - MARGIN

const BLACK = rgb(0.08, 0.09, 0.11)
const GREY  = rgb(0.45, 0.47, 0.5)
const LINE  = rgb(0.85, 0.86, 0.88)
const BAR   = rgb(0.85, 0.55, 0.1)
const BARBG = rgb(0.92, 0.92, 0.93)

type Fonts = { helv: PDFFont; helvB: PDFFont; logo: PDFImage }
type Cursor = { doc: PDFDocument; page: PDFPage; y: number; fonts: Fonts }

const num = (n: number) => (n || 0).toLocaleString("en-GB")
const pctStr = (n: number) => `${(n ?? 0).toFixed(1)}%`

// pdf-lib's standard fonts are WinAnsi — anything outside it throws when drawn.
function safeAscii(text: string): string {
  return String(text ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E£€]/g, "")
}

function drawRight(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: any) {
  const t = safeAscii(text)
  page.drawText(t, { x: x - font.widthOfTextAtSize(t, size), y, size, font, color })
}

/** ⚠ drawText does NOT wrap. Everything free-text goes through this. */
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safeAscii(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (line && font.widthOfTextAtSize(test, size) > maxWidth) { lines.push(line); line = w }
    else line = test
  }
  if (line) lines.push(line)
  return lines
}

function ensure(cur: Cursor, needed: number) {
  if (cur.y - needed > MARGIN + 24) return
  cur.page = cur.doc.addPage([PAGE_W, PAGE_H])
  cur.y = PAGE_H - MARGIN
}

async function buildPdf(d: VendorLocations): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Vendor Locations")
  doc.setAuthor("Vectis Auctions")

  const fonts: Fonts = {
    helv:  await doc.embedFont(StandardFonts.Helvetica),
    helvB: await doc.embedFont(StandardFonts.HelveticaBold),
    logo:  await embedVectisLogo(doc),
  }
  const cur: Cursor = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, fonts }
  const printed = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })

  // ── Header ──
  const logoH = 44
  const logoW = logoH * (fonts.logo.width / fonts.logo.height)
  cur.page.drawImage(fonts.logo, { x: MARGIN, y: cur.y - logoH, width: logoW, height: logoH })
  drawRight(cur.page, "Vendor Locations", RIGHT, cur.y - 12, 15, fonts.helvB, BLACK)
  const basisWord = d.range.basis === "auction" ? "Sold" : d.range.basis === "catalogued" ? "Catalogued" : "Goods received"
  const period = d.range.from || d.range.to
    ? `${basisWord} ${d.range.from ?? "the start"} to ${d.range.to ?? "today"}`
    : "Everything we hold"
  drawRight(cur.page, period, RIGHT, cur.y - 28, 10, fonts.helv, GREY)
  drawRight(cur.page, `Printed ${printed}`, RIGHT, cur.y - 41, 8, fonts.helv, GREY)
  cur.y -= logoH + 14
  cur.page.drawLine({ start: { x: MARGIN, y: cur.y }, end: { x: RIGHT, y: cur.y }, thickness: 1.5, color: BLACK })
  cur.y -= 22

  // ── Summary ──
  const stats: [string, string][] = [
    ["Vendors on receipts", num(d.totals.vendors)],
    ["Receipts", num(d.totals.receipts)],
    ["Lots sent in", num(d.totals.lots)],
    ["Countries", num(d.totals.countries)],
  ]
  const sw = (RIGHT - MARGIN) / stats.length
  stats.forEach(([label, val], i) => {
    const x = MARGIN + i * sw
    cur.page.drawText(safeAscii(label.toUpperCase()), { x, y: cur.y, size: 7.5, font: fonts.helv, color: GREY })
    cur.page.drawText(safeAscii(val), { x, y: cur.y - 17, size: 16, font: fonts.helvB, color: BLACK })
  })
  cur.y -= 40

  // ── How the countries were decided ──
  const note = `Business Central does not hold a country for any vendor, so it is worked out from the address. `
    + `${num(d.totals.workedOut)} were placed this way. ${num(d.totals.unknown)} could not be: `
    + `${num(d.totals.noAddress)} have no address in Business Central at all, and `
    + `${num(d.totals.unknownWithAddress)} have an address that could not be matched. `
    + `Those are listed at the end rather than counted as United Kingdom.`
    + (d.undated ? ` ${num(d.undated)} lots have no ${basisWord.toLowerCase()} date in Business Central, so they cannot appear in a dated report.` : "")
  for (const ln of wrapLines(note, fonts.helv, 8.5, RIGHT - MARGIN)) {
    cur.page.drawText(ln, { x: MARGIN, y: cur.y, size: 8.5, font: fonts.helv, color: GREY })
    cur.y -= 11
  }
  cur.y -= 12

  // ── By country ──
  cur.page.drawText("By country", { x: MARGIN, y: cur.y, size: 11, font: fonts.helvB, color: BLACK })
  cur.y -= 16

  const cols = [
    { x: MARGIN,       w: 132, label: "Country",  right: false },
    { x: MARGIN + 136, w: 44,  label: "Vendors",  right: true  },
    { x: MARGIN + 184, w: 34,  label: "%",        right: true  },
    { x: MARGIN + 222, w: 48,  label: "Receipts", right: true  },
    { x: MARGIN + 274, w: 34,  label: "%",        right: true  },
    { x: MARGIN + 312, w: 48,  label: "Lots",     right: true  },
    { x: MARGIN + 364, w: 34,  label: "%",        right: true  },
    { x: MARGIN + 402, w: 56,  label: "Lots each", right: true },
  ]

  const head = () => {
    for (const c of cols) {
      if (c.right) drawRight(cur.page, c.label.toUpperCase(), c.x + c.w, cur.y, 7, fonts.helv, GREY)
      else cur.page.drawText(safeAscii(c.label.toUpperCase()), { x: c.x, y: cur.y, size: 7, font: fonts.helv, color: GREY })
    }
    cur.y -= 5
    cur.page.drawLine({ start: { x: MARGIN, y: cur.y }, end: { x: RIGHT, y: cur.y }, thickness: 0.7, color: LINE })
    cur.y -= 12
  }
  head()

  const maxV = Math.max(1, ...d.rows.map(r => r.vendors))
  for (const r of d.rows) {
    ensure(cur, 26)
    if (cur.y === PAGE_H - MARGIN) head()
    const vals = [
      r.name,
      num(r.vendors), pctStr(r.vendorPct),
      num(r.receipts), pctStr(r.receiptPct),
      num(r.lots), pctStr(r.lotPct),
      r.vendors ? num(Math.round(r.lots / r.vendors)) : "-",
    ]
    cols.forEach((c, i) => {
      const bold = r.code === "??" ? fonts.helv : fonts.helvB
      const font = i === 0 ? bold : fonts.helv
      if (c.right) drawRight(cur.page, vals[i], c.x + c.w, cur.y, 8, font, BLACK)
      else cur.page.drawText(safeAscii(vals[i]).slice(0, 30), { x: c.x, y: cur.y, size: 8, font, color: BLACK })
    })
    // Share bar under the row, so the shape of the book reads at a glance.
    const barY = cur.y - 4.5
    const barW = RIGHT - (MARGIN + 466)
    cur.page.drawRectangle({ x: MARGIN + 466, y: barY, width: barW, height: 3, color: BARBG })
    cur.page.drawRectangle({ x: MARGIN + 466, y: barY, width: Math.max(0.6, barW * (r.vendors / maxV)), height: 3, color: BAR })
    cur.y -= 14
  }

  // ⚠ A gap after a table, or the next block sits on the last row.
  cur.y -= 10
  cur.page.drawLine({ start: { x: MARGIN, y: cur.y }, end: { x: RIGHT, y: cur.y }, thickness: 0.7, color: LINE })
  cur.y -= 16

  // ── How the country was decided ──
  ensure(cur, 60)
  cur.page.drawText("How the country was decided", { x: MARGIN, y: cur.y, size: 11, font: fonts.helvB, color: BLACK })
  cur.y -= 16
  for (const r of [...d.reasons, { reason: "Could not be decided", count: d.totals.unknown }]) {
    ensure(cur, 16)
    cur.page.drawText(safeAscii(r.reason), { x: MARGIN, y: cur.y, size: 8.5, font: fonts.helv, color: BLACK })
    drawRight(cur.page, num(r.count), MARGIN + 240, cur.y, 8.5, fonts.helvB, BLACK)
    cur.y -= 13
  }
  cur.y -= 14

  // ── The ones we could not place ──
  if (d.unknownSample.length) {
    ensure(cur, 70)
    cur.page.drawText("Vendors we could not place", { x: MARGIN, y: cur.y, size: 11, font: fonts.helvB, color: BLACK })
    cur.y -= 14
    for (const ln of wrapLines("The ones with a town or a postcode are worth a look. The ones marked no address have nothing in Business Central to work from.", fonts.helv, 8, RIGHT - MARGIN)) {
      cur.page.drawText(ln, { x: MARGIN, y: cur.y, size: 8, font: fonts.helv, color: GREY })
      cur.y -= 10
    }
    cur.y -= 6

    const uc = [
      { x: MARGIN,       w: 60,  label: "Vendor" },
      { x: MARGIN + 66,  w: 130, label: "Name" },
      { x: MARGIN + 202, w: 100, label: "Town" },
      { x: MARGIN + 308, w: 100, label: "County" },
      { x: MARGIN + 414, w: 108, label: "Postcode" },
    ]
    const uhead = () => {
      for (const c of uc) cur.page.drawText(c.label.toUpperCase(), { x: c.x, y: cur.y, size: 7, font: fonts.helv, color: GREY })
      cur.y -= 5
      cur.page.drawLine({ start: { x: MARGIN, y: cur.y }, end: { x: RIGHT, y: cur.y }, thickness: 0.7, color: LINE })
      cur.y -= 11
    }
    uhead()

    for (const u of d.unknownSample) {
      ensure(cur, 20)
      if (cur.y === PAGE_H - MARGIN) uhead()
      const vals = [
        u.vendorNo,
        u.name ?? "-",
        u.city ?? (u.hasAddress ? "-" : "no address"),
        u.county ?? "-",
        u.postCode ?? "-",
      ]
      uc.forEach((c, i) => {
        const txt = safeAscii(vals[i])
        let out = txt
        while (out.length > 1 && fonts.helv.widthOfTextAtSize(out, 7.5) > c.w) out = out.slice(0, -1)
        cur.page.drawText(out, { x: c.x, y: cur.y, size: 7.5, font: fonts.helv, color: u.hasAddress ? BLACK : GREY })
      })
      cur.y -= 11
    }
  }

  // ── Footer on every page ──
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const foot = `Vectis Auctions  ·  Vendor Locations  ·  Page ${i + 1} of ${pages.length}`
    p.drawText(safeAscii(foot), { x: MARGIN, y: MARGIN - 14, size: 7, font: fonts.helv, color: GREY })
    if (d.lastSync) {
      drawRight(p, `Vendor addresses last pulled ${new Date(d.lastSync).toLocaleDateString("en-GB")}`, RIGHT, MARGIN - 14, 7, fonts.helv, GREY)
    }
  })

  return doc.save()
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const d = await computeVendorLocations({ from: searchParams.get("from"), to: searchParams.get("to"), basis: (searchParams.get("basis") as any) || null })
    const bytes = await buildPdf(d)
    const stamp = new Date().toISOString().slice(0, 10)

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="vendor-locations-${stamp}.pdf"`,
        "Content-Length":      String(bytes.length),
      },
    })
  } catch (e: any) {
    console.error("vendor-locations/pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
