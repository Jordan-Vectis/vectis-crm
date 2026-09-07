import type { Readable } from "node:stream"
import ExcelJS from "exceljs"

// Reads the old system's lot export (Databases → Lot Archive) as a STREAM, one row
// at a time, so a twenty-year file never has to fit in memory. The first version
// read the whole workbook with SheetJS and a 136 MB export (Sep 2026) simply killed
// the request — SheetJS builds an object per cell, several GB for ~4M cells.
// Columns:
//   AuctionID · AuctionDate · OnlineTitle · Lot · Description · BottomPrice · TopPrice · HammerPrice
// ⚠ AuctionDate is US-style MM/DD/YYYY (" 07/21/2022", note the leading space), and
// Lot arrives with thousands separators ("2,265"). Headers are matched loosely so a
// re-export with slightly different names still loads. .xlsx and .csv only — the old
// binary .xls can't be streamed; save it as .xlsx first.

// LotID is optional (the Excel export lacked it; the Crystal Reports Viewer export has
// it). When present it is the website's unique_id and the photo is filed under it, so
// the photo path is known at import time and the website pull is only needed for
// lots the sheet never had.
export type ArchiveRow = {
  auctionId: number; auctionDate: Date | null; saleTitle: string; lot: number
  description: string; estimateLow: number | null; estimateHigh: number | null; hammerPrice: number | null
  lotId: string | null; sitePhoto: string | null
}
export const sitePhotoFor = (lotId: string) => `lot_images/large/${lotId}/${lotId}.webp`

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const n = parseFloat(String(v).replace(/[£$,\s]/g, ""))
  return Number.isFinite(n) ? n : null
}
const int = (v: unknown): number | null => {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

/** MM/DD/YYYY (or M/D/YY), an ISO string, a Date, or an Excel serial — anything else → null. */
export function parseArchiveDate(v: unknown): Date | null {
  if (v == null || v === "") return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === "number") {                       // Excel serial day count
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000)
    return isNaN(d.getTime()) ? null : d
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    let y = +m[3]; if (y < 100) y += y >= 70 ? 1900 : 2000
    const d = new Date(Date.UTC(y, +m[1] - 1, +m[2]))
    return isNaN(d.getTime()) ? null : d
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return null
}

function findCol(headers: string[], ...names: string[]): number {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "")
  const H = headers.map(norm)
  for (const n of names) { const i = H.indexOf(norm(n)); if (i >= 0) return i }
  for (const n of names) { const i = H.findIndex(h => h.includes(norm(n))); if (i >= 0) return i }
  return -1
}

type Cols = { cA: number; cD: number; cT: number; cL: number; cDesc: number; cLo: number; cHi: number; cH: number; cId: number }

export function mapHeaders(headers: string[]): Cols {
  const cols: Cols = {
    cId: findCol(headers, "LotID", "LotId", "UniqueID", "UniqueId", "LotUniqueId"),   // never a bare "ID" — it would match AuctionID
    cA: findCol(headers, "AuctionID", "AuctionId", "SaleId"), cD: findCol(headers, "AuctionDate", "SaleDate", "Date"),
    cT: findCol(headers, "OnlineTitle", "SaleTitle", "Title"), cL: findCol(headers, "Lot", "LotNumber", "LotNo"),
    cDesc: findCol(headers, "Description"), cLo: findCol(headers, "BottomPrice", "EstimateLow", "LowEstimate"),
    cHi: findCol(headers, "TopPrice", "EstimateHigh", "HighEstimate"), cH: findCol(headers, "HammerPrice", "Hammer", "SoldPrice"),
  }
  if (cols.cA < 0 || cols.cL < 0 || cols.cDesc < 0) throw new Error(`Couldn't find the AuctionID, Lot and Description columns — headers were: ${headers.join(", ")}`)
  return cols
}

/** One sheet row → an ArchiveRow, "bad" (has content but no usable AuctionID/Lot/Description) or "empty". */
export function rowFrom(r: unknown[], c: Cols): ArchiveRow | "bad" | "empty" {
  const auctionId = int(r[c.cA]), lot = int(r[c.cL])
  const description = String(r[c.cDesc] ?? "").trim()
  if (auctionId == null || lot == null || !description) return r.some(v => v !== "" && v != null) ? "bad" : "empty"
  const idNum = c.cId >= 0 ? int(r[c.cId]) : null
  const lotId = idNum != null && idNum > 0 ? String(idNum) : (c.cId >= 0 ? (String(r[c.cId] ?? "").trim() || null) : null)
  return {
    auctionId, lot, description,
    lotId, sitePhoto: lotId ? sitePhotoFor(lotId) : null,
    auctionDate: c.cD >= 0 ? parseArchiveDate(r[c.cD]) : null,
    saleTitle: c.cT >= 0 ? String(r[c.cT] ?? "").trim() : "",
    estimateLow: c.cLo >= 0 ? num(r[c.cLo]) : null,
    estimateHigh: c.cHi >= 0 ? num(r[c.cHi]) : null,
    hammerPrice: c.cH >= 0 ? num(r[c.cH]) : null,
  }
}

// ExcelJS hands back rich text / hyperlinks / formulas as objects — flatten to text.
function cellText(v: unknown): unknown {
  if (v == null) return ""
  if (v instanceof Date || typeof v === "number" || typeof v === "boolean") return v
  if (typeof v === "object") {
    const o = v as any
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t?.text ?? "").join("")
    if (o.result !== undefined) return cellText(o.result)
    if (o.text !== undefined) return String(o.text)
    if (o.error !== undefined) return ""
    return String(v)
  }
  return String(v)
}

// A small streaming CSV reader: quotes, doubled quotes, commas and line breaks inside
// quotes, CRLF, and a BOM. Yields one array of cell strings per record.
async function* csvRows(stream: Readable): AsyncGenerator<string[]> {
  const dec = new TextDecoder("utf-8")
  let inQ = false, field = "", row: string[] = [], first = true, carry = ""
  for await (const chunk of stream) {
    let s = carry + dec.decode(chunk as Buffer, { stream: true }); carry = ""
    if (first) { s = s.replace(/^﻿/, ""); first = false }
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (inQ) {
        if (c === '"') {
          if (i === s.length - 1) { carry = '"'; break }          // may be a doubled quote split across chunks
          if (s[i + 1] === '"') { field += '"'; i++ } else inQ = false
        } else field += c
      }
      else if (c === '"') inQ = true
      else if (c === ",") { row.push(field); field = "" }
      else if (c === "\n") { row.push(field); field = ""; yield row; row = [] }
      else if (c !== "\r") field += c
    }
  }
  if (carry) { if (inQ) inQ = false }                              // a lone closing quote at the very end
  const tail = dec.decode(); if (tail) field += tail
  if (field !== "" || row.length) { row.push(field); yield row }
}

/**
 * Streams every data row of the file to onRow (an ArchiveRow, or "bad" for a row
 * with content that couldn't be read). Only the first sheet of a workbook is read.
 */
export async function readArchiveStream(stream: Readable, ext: string, onRow: (r: ArchiveRow | "bad") => Promise<void>): Promise<{ headers: string[]; sheets: number }> {
  // ⚠ The Crystal Reports Viewer export SPLITS the data across many sheets (Sheet1…
  // Sheet11…), each starting with its own header row — so every sheet is read, and the
  // first non-blank row of each is tried as a header (kept as data if it isn't one).
  let cols: Cols | null = null, headers: string[] = [], sheets = 0, sheetStart = true
  const handle = async (cells: unknown[]) => {
    if (!cells.some(v => v !== "" && v != null)) return                    // blank line
    if (sheetStart) {
      sheetStart = false
      const h = cells.map(v => String(v ?? "").trim())
      try { cols = mapHeaders(h); headers = h; return } catch (e) { if (!cols) throw e }   // not a header: data continues under the last header
    }
    const r = rowFrom(cells, cols!)
    if (r !== "empty") await onRow(r)
  }
  if (ext === "csv") {
    sheets = 1
    for await (const cells of csvRows(stream)) await handle(cells)
  } else if (ext === "xls") {
    throw new Error("The old binary .xls format can't be streamed — open it in Excel and save it as .xlsx (or .csv), then import that")
  } else {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, { sharedStrings: "cache", hyperlinks: "ignore", styles: "ignore", worksheets: "emit", entries: "emit" })
    // ⚠ exceljs 4.4 crashes ("Cannot read properties of undefined (reading 'sheets')")
    // when a worksheet turns up in the zip before workbook.xml — it only uses the
    // model to name the sheet, which we don't need, so give it an empty one to start.
    ;(reader as any).model ??= { sheets: [] }
    for await (const ws of reader) {
      sheets++; sheetStart = true
      for await (const row of ws) {
        const vals = Array.from((row.values as unknown[]) ?? [])          // 1-based, may be sparse
        await handle(vals.slice(1).map(cellText))
      }
    }
  }
  if (!cols) throw new Error("The file looks empty — no header row found")
  return { headers, sheets }
}
