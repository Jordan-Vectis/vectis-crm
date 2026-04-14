"use client"

import { useRef, useState, useTransition } from "react"
import * as XLSX from "xlsx"
import { importLots } from "@/lib/actions/catalogue"

interface Props {
  auctionId: string
  auctionCode: string
  onImported: () => void
}

interface PreviewRow {
  lotNumber: string; title: string; description: string
  estimateLow: string; estimateHigh: string; reserve: string
  condition: string; status: string; vendor: string
  tote: string; receipt: string; category: string
  subCategory: string; brand: string; notes: string
}

export default function ImportTab({ auctionId, auctionCode, onImported }: Props) {
  const fileRef              = useRef<HTMLInputElement>(null)
  const [rows, setRows]      = useState<PreviewRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError]    = useState<string | null>(null)
  const [result, setResult]  = useState<string | null>(null)
  const [pending, start]     = useTransition()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setResult(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb      = XLSX.read(ev.target!.result, { type: "binary" })
        const ws      = wb.Sheets[wb.SheetNames[0]]
        const raw     = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws)
        // Detect format by checking first row headers
        const firstRow = raw[0] as Record<string, string | number>
        const isCatalogueFormat = "Internal Barcode" in firstRow

        const parsed = raw.map(r => {
          if (isCatalogueFormat) {
            return {
              lotNumber:    String(r["Internal Barcode"] ?? "").trim(),
              title:        "",
              description:  String(r["Key Points"]       ?? "").trim(),
              estimateLow:  String(r["Estimate Low"]     ?? "").trim(),
              estimateHigh: String(r["Estimate High"]    ?? "").trim(),
              reserve:      "",
              condition:    String(r["Condition"]        ?? "").trim(),
              status:       "ENTERED",
              vendor:       String(r["Vendor"]           ?? "").trim(),
              tote:         String(r["Tote"]             ?? "").trim(),
              receipt:      String(r["Receipt No"]       ?? "").trim(),
              category:     String(r["Main Category"]    ?? "").trim(),
              subCategory:  String(r["Sub Category"]     ?? "").trim(),
              brand:        String(r["Brand"]            ?? "").trim(),
              notes:        String(r["Parcel Size"]      ?? "").trim(),
            }
          }
          return {
            lotNumber:    String(r["Lot No."]      ?? "").trim(),
            title:        String(r["Title"]        ?? "").trim(),
            description:  String(r["Description"]  ?? "").trim(),
            estimateLow:  String(r["Estimate Low"]  ?? "").trim(),
            estimateHigh: String(r["Estimate High"] ?? "").trim(),
            reserve:      String(r["Reserve"]       ?? "").trim(),
            condition:    String(r["Condition"]     ?? "").trim(),
            status:       String(r["Status"]        ?? "").trim(),
            vendor:       String(r["Vendor"]        ?? "").trim(),
            tote:         String(r["Tote"]          ?? "").trim(),
            receipt:      String(r["Receipt"]       ?? "").trim(),
            category:     String(r["Category"]      ?? "").trim(),
            subCategory:  String(r["Sub-Category"]  ?? "").trim(),
            brand:        String(r["Brand"]         ?? "").trim(),
            notes:        String(r["Notes"]         ?? "").trim(),
          }
        }).filter(r => r.lotNumber)

        if (parsed.length === 0) { setError("No valid rows found — make sure the file has a 'Lot No.' or 'Internal Barcode' column."); return }
        setRows(parsed)
      } catch {
        setError("Could not read file — make sure it's a valid Excel file.")
      }
    }
    reader.readAsBinaryString(file)
    e.target.value = ""
  }

  function handleImport() {
    if (rows.length === 0) return
    start(async () => {
      try {
        const count = await importLots(auctionId, rows)
        setResult(`✓ Imported ${count} lots successfully.`)
        setRows([])
        setFileName(null)
        onImported()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed")
      }
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-gray-200">Import Lots</h2>
        <p className="text-xs text-gray-500 mt-0.5">{auctionCode} — upload an Excel file exported from this app</p>
      </div>

      {/* File picker */}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      <button onClick={() => fileRef.current?.click()}
        className="w-full py-8 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-400 hover:text-[#2AB4A6] transition-colors flex flex-col items-center gap-2 mb-4">
        <span className="text-3xl">📂</span>
        <span className="text-sm font-medium">{fileName ?? "Choose Excel file"}</span>
        <span className="text-xs text-gray-600">Must be exported from this app</span>
      </button>

      {error  && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mb-4">{error}</p>}
      {result && <p className="text-xs text-[#2AB4A6] bg-[#2AB4A6]/10 rounded-lg px-3 py-2 mb-4">{result}</p>}

      {/* Preview */}
      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400">{rows.length} lots ready to import</p>
            <button onClick={handleImport} disabled={pending}
              className="px-5 py-2 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              {pending ? "Importing…" : `Import ${rows.length} Lots`}
            </button>
          </div>
          <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-700 bg-[#141416]">
                  {["Lot No.", "Title", "Vendor", "Tote", "Category", "Status"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-[#2C2C2E]">
                    <td className="px-3 py-2 font-mono text-[#2AB4A6]">{r.lotNumber}</td>
                    <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate">{r.title || "—"}</td>
                    <td className="px-3 py-2 text-gray-400">{r.vendor || "—"}</td>
                    <td className="px-3 py-2 text-gray-400 font-mono">{r.tote || "—"}</td>
                    <td className="px-3 py-2 text-gray-400">{r.category || "—"}</td>
                    <td className="px-3 py-2 text-gray-400">{r.status || "ENTERED"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
