import * as XLSX from "xlsx"

// Parses the old system's lot export (Databases → Lot Archive). One row per lot:
//   AuctionID · AuctionDate · OnlineTitle · Lot · Description · BottomPrice · TopPrice · HammerPrice
// ⚠ AuctionDate is US-style MM/DD/YYYY (" 07/21/2022", note the leading space), and
// Lot arrives with thousands separators ("2,265"). Headers are matched loosely so a
// re-export with slightly different names still loads.

export type ArchiveRow = {
  auctionId: number; auctionDate: Date | null; saleTitle: string; lot: number
  description: string; estimateLow: number | null; estimateHigh: number | null; hammerPrice: number | null
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const n = parseFloat(String(v).replace(/[£$,\s]/g, ""))
  return Number.isFinite(n) ? n : null
}
const int = (v: unknown): number | null => {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

/** MM/DD/YYYY (or M/D/YY), an ISO string, or an Excel serial — anything else → null. */
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

export function parseArchiveSheet(buf: Buffer): { rows: ArchiveRow[]; bad: number; headers: string[] } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" })
  if (!grid.length) return { rows: [], bad: 0, headers: [] }
  const headers = (grid[0] as unknown[]).map(h => String(h ?? ""))
  const cA = findCol(headers, "AuctionID", "AuctionId", "SaleId"), cD = findCol(headers, "AuctionDate", "SaleDate", "Date")
  const cT = findCol(headers, "OnlineTitle", "SaleTitle", "Title"), cL = findCol(headers, "Lot", "LotNumber", "LotNo")
  const cDesc = findCol(headers, "Description"), cLo = findCol(headers, "BottomPrice", "EstimateLow", "LowEstimate")
  const cHi = findCol(headers, "TopPrice", "EstimateHigh", "HighEstimate"), cH = findCol(headers, "HammerPrice", "Hammer", "SoldPrice")
  if (cA < 0 || cL < 0 || cDesc < 0) throw new Error(`Couldn't find the AuctionID, Lot and Description columns — headers were: ${headers.join(", ")}`)

  const rows: ArchiveRow[] = []; let bad = 0
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] as unknown[]
    const auctionId = int(r[cA]), lot = int(r[cL])
    const description = String(r[cDesc] ?? "").trim()
    if (auctionId == null || lot == null || !description) { if (r.some(v => v !== "" && v != null)) bad++; continue }
    rows.push({
      auctionId, lot, description,
      auctionDate: cD >= 0 ? parseArchiveDate(r[cD]) : null,
      saleTitle: cT >= 0 ? String(r[cT] ?? "").trim() : "",
      estimateLow: cLo >= 0 ? num(r[cLo]) : null,
      estimateHigh: cHi >= 0 ? num(r[cHi]) : null,
      hammerPrice: cH >= 0 ? num(r[cH]) : null,
    })
  }
  return { rows, bad, headers }
}
