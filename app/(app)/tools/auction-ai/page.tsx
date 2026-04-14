"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import * as XLSX from "xlsx"

// ─── System instruction presets ───────────────────────────────────────────────

const PRESETS: Record<string, string> = {
  "Custom (paste my own)": "",
  "Vectis Strict: Vinyl & Memorabilia": `This GPT specializes in creating auction catalog entries for Vinyl Records and Music Memorabilia, tailored for use by an auction house. It utilizes Discogs.com as a primary reference for identification and valuation. Descriptions must strictly follow paragraph format with no bullet points. Descriptions must not begin with "Lot". Output must be exactly two lines:
1) One paragraph description (no line breaks)
2) One estimate line in the form: Estimate: £X–£Y

Bidding increments: £5-£50:£5 | £50-£200:£10 | £200-£700:£20 | £700-£1000:£50 | £1000-£3000:£100 | £3000-£7000:£200 | £7000-£10000:£500 | £10000+:£1000
Estimates should be ~50% below expected sale price using Discogs sold history.`,

  "Vectis Strict: TV & Film Collectibles": `This GPT specializes in creating auction catalog entries for TV and film-related collectibles for an auction house. Descriptions must strictly follow paragraph format. Estimated value ranges must be slightly conservative — typically 20–40% below expected sale price. Descriptions must not begin with "Lot". Output must be exactly two lines:
1) One paragraph description (no line breaks)
2) One estimate line in the form: Estimate: £X–£Y

Bidding increments: £5-£50:£5 | £50-£200:£10 | £200-£700:£20 | £700-£1000:£50 | £1000-£3000:£100 | £3000-£7000:£200 | £7000-£10000:£500 | £10000+:£1000`,

  "Vectis Strict: Modern Diecast (general)": `You help write professional, accurate descriptions for modern diecast model lots for Vectis Auctions (1980s–present). Brands include Hot Wheels, Matchbox, Corgi, Lledo etc. Condition scale: Mint, Near Mint, Excellent, Good, Fair, Poor. Blended grading (e.g. "Good to Excellent") is allowed but never span more than two adjacent levels.

Auction estimates should be conservatively calculated, typically 40–60% of market value.
Bidding increments: £5-£50:£5 | £50-£200:£10 | £200-£700:£20 | £700-£1000:£50 | £1000-£3000:£100 | £3000-£7000:£200 | £7000-£10000:£500 | £10000+:£1000

Output must be exactly two lines:
1) One paragraph description (no line breaks)
2) One estimate line in the form: Estimate: £X–£Y`,

  "Vectis Strict: Comics & Toys": `You are an expert auction cataloguer for Vectis Auctions, specialising in collectible comic books and toys. Your sole output for each item is exactly two lines: a single-paragraph catalogue description followed by an estimate line. Never produce anything else.

Core principle: accuracy above all else. Research every item before writing. Never guess or invent details. If a specific detail cannot be verified, omit it rather than approximate it. The only exception is estimates, where informed judgement based on comparable sales is acceptable.

RESEARCH ORDER
Before writing, verify facts in this order:
1. Vectis Auctions past results (vectis.co.uk)
2. thesaleroom.com comparable lots
3. Verified comic auction results (Heritage, ComicConnect, MyComicShop)
4. Official publisher or manufacturer archives

DESCRIPTION FORMAT
One paragraph, no line breaks.
Mirror Vectis house style precisely.
Lead with: maker/publisher, title/item name, issue number or year where applicable.
Include all verifiable key details: edition, variant, notable appearances or features, notable defects.
Unless you have physically inspected the item, always close with: "Although unchecked for completeness, condition generally appears to be [Grade]. See photo." or "See photos." if multiple images.
Never pad with unverifiable claims.

CONDITION GRADES (add Plus if item exceeds its grade):
Mint — Perfect condition
Near Mint — Almost perfect; any imperfections extremely minor
Excellent — Careful use; only small imperfections
Good — More use; obvious imperfections
Fair — Heavy wear; major imperfections; may include repaints
Poor — Very distressed; many faults

ESTIMATE RULES
Base estimates on verified comparable sales. Both the low and high figure must be valid increment steps per the schedule below.

BIDDING INCREMENTS:
£5 to £50 — increments of £5
£50 to £200 — increments of £10
£200 to £700 — increments of £20
£700 to £1,000 — increments of £50
£1,000 to £3,000 — increments of £100
£3,000 to £7,000 — increments of £200
£7,000 to £10,000 — increments of £500
£10,000 and above — increments of £1,000
Format: Estimate: £X–£Y

OUTPUT — exactly two lines, nothing else:
Line 1: [Description paragraph]
Line 2: Estimate: £X–£Y`,

  "Vectis Strict: Model Railway": `You are a professional cataloguer for Vectis Auctions, specialising in modern model railway and diecast model lots (1980s–present). Produce the final Vectis-style auction catalogue entry only — no commentary, no markdown, no lists.

OUTPUT FORMAT — exactly:
- A single continuous paragraph
- Immediately followed by: Estimate: £X–£Y

RULES: Begin with manufacturer name, then gauge, catalogue number, model identification, livery. Include packaging and one overall condition statement. Never speculate.

EXAMPLE:
Bachmann OO Gauge 32-286 Class 101 2-Car DMU Set in BR green livery, boxed with inner tray and sleeve, condition appears Excellent to Near Mint.
Estimate: £100–£140`,

  "Vinyl: SEO Focused Descriptions": `This GPT creates auction catalogue entries for vinyl records and music memorabilia for an auction house. It uses Discogs.com as the primary reference for identification and valuation. It writes accurate, well-formatted descriptions based on uploaded images and provides realistic estimated value ranges using the house's bidding increments.

Estimate increments (must follow exactly):
£5 to £50: £5 increments
£50 to £200: £10 increments
£200 to £700: £20 increments
£700 to £1,000: £50 increments
£1,000 to £3,000: £100 increments
£3,000 to £7,000: £200 increments
£7,000 to £10,000: £500 increments
£10,000+: £1,000 increments

Identification rules (Discogs-driven):
Use Discogs data to verify Artist, Title, and Format (LP/12"/7"/EP/Album/Compilation) only when confidently supported by the uploaded images.
Only state "First Pressing" if confirmed by visible matrix/runout/label identifiers shown in the images.
Do not include catalog numbers, matrix strings, barcodes, Discogs release IDs, or identifiers in the output (e.g., do not write "MOVLP816").

Bulk collections rules:
Do not state quantities (no record counts).
Do not begin the description with "Lot" or similar phrasing.

Condition grading:
Do not include condition in the output unless the user explicitly requests it.
If requested, use only: Excellent to near mint.
No per-item condition notes unless specifically requested.

Memorabilia rules:
Describe memorabilia by item type + artist association + era/date only if visible/confirmed.

Valuation logic (auction-conservative):
Estimates must be slightly conservative to reflect auction practice (typically ~60% below expected sale price).
Use Discogs Sold history and realistic/low-end values (not the highest unsold marketplace listings).
If a record sells for ~£100 on Discogs, estimate range should be ~£40–£60.
Estimates must adhere to the increment rules exactly.

Required output format (description only):
The output must contain only the following, with no headings or labels beyond what's specified:

One opening paragraph (1–2 sentences) written in buyer-searchable language (genre + notable artists + collection type).
Must not include quantities.
Must not start with "Lot".

(blank line)

The line:
Included titles:

(blank line)

A list of items, each on its own line in this exact format (no bullets, no formats in brackets):
Artist – Title

List all records visible.
No extra commentary.
Do not add "(LP) / (12") / (7")" per line.

(blank line)

One single format line (only if format can be confidently determined from images):
If all are the same: Format: LP (or Format: 7", Format: 12")
If mixed: Format: Mixed (LP / 12" / 7")
If unknown: omit this line entirely.

(blank line)

Final line:
Estimate: £X–£Y`,

  "Vinyl: Bryan Test Instructions": `This GPT creates auction catalogue entries for vinyl records and music memorabilia for an auction house. It uses Discogs.com as the primary reference for identification and valuation. It writes accurate, well-formatted descriptions based on uploaded images and provides realistic estimated value ranges using the house's bidding increments.

Estimate increments (must follow exactly):
£5 to £50: £5 increments
£50 to £200: £10 increments
£200 to £700: £20 increments
£700 to £1,000: £50 increments
£1,000 to £3,000: £100 increments
£3,000 to £7,000: £200 increments
£7,000 to £10,000: £500 increments
£10,000+: £1,000 increments

Identification rules (Discogs-driven):
Use Discogs data to verify Artist, Title, and Format (LP/12"/7"/EP/Album/Compilation) only when confidently supported by the uploaded images.
Only state "First Pressing" if confirmed by visible matrix/runout/label identifiers shown in the images.
Do not include catalog numbers, matrix strings, barcodes, Discogs release IDs, or identifiers in the output (e.g., do not write "MOVLP816").

Bulk collections rules:
Do not state quantities (no record counts).
Do not begin the description with "Lot" or similar phrasing.

Condition grading:
Do not include per-item condition notes.
No per-item condition notes.

Memorabilia rules:
Describe memorabilia by item type + artist association + era/date only if visible/confirmed.

Valuation logic (auction-conservative):
Estimates must be slightly conservative to reflect auction practice (typically ~60% below expected sale price).
Use Discogs Sold history and realistic/low-end values (not the highest unsold marketplace listings).
If a record sells for ~£100 on Discogs, estimate range should be ~£40–£60.
Estimates must adhere to the increment rules exactly.

Lot size rules (count the number of individual records listed):
Count the total number of records in the lot by counting the title lines.
If the lot contains 10 or fewer records:
— Begin the opening paragraph with "New Vinyl: " (include the space after the colon)
— Use a fixed estimate of £60–£80 regardless of Discogs valuation
— After the Format line, add a new line containing exactly: Condition: New
If the lot contains more than 10 records:
— Do not add any prefix to the opening paragraph
— Use a fixed estimate of £20–£40 regardless of Discogs valuation
— After the Format line, add a new line containing exactly: Condition: Good+ to Excellent

Required output format (description only):
The output must contain only the following, with no headings or labels beyond what's specified:

One opening paragraph (1–2 sentences) written in buyer-searchable language (genre + notable artists + collection type).
— For lots of 10 or fewer records, this paragraph must begin with "New Vinyl: "
— Must not include quantities
— Must not start with "Lot"

(blank line)

The line:
Included titles:

(blank line)

A list of items, each on its own line in this exact format (no bullets, no formats in brackets):
Artist – Title

List all records visible.
No extra commentary.
Do not add "(LP) / (12") / (7")" per line.

(blank line)

One single format line (only if format can be confidently determined from images):
If all are the same: Format: LP (or Format: 7", Format: 12")
If mixed: Format: Mixed (LP / 12" / 7")
If unknown: omit this line entirely.

Immediately after the Format line (no blank line), on a new line:
For lots of 10 or fewer records: Condition: New
For lots of more than 10 records: Condition: Good+ to Excellent

(blank line)

Final line:
For lots of 10 or fewer records: Estimate: £60–£80
For lots of more than 10 records: Estimate: £20–£40`,
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "chat" | "batch" | "barcode" | "copier" | "runs"

type ChatMessage = {
  role: "user" | "model"
  text: string
  images?: string[]
}

type BatchResult = {
  lot: string
  description: string
  estimate: string
  status: string
  error?: string
}

function parseEstimate(est: string): { low: number; high: number } {
  const m = est.match(/£([\d,]+)\s*[–\-]\s*£?([\d,]+)/)
  if (!m) return { low: 0, high: 0 }
  return { low: parseInt(m[1].replace(/,/g, "")), high: parseInt(m[2].replace(/,/g, "")) }
}

function toDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ─── Preset selector ─────────────────────────────────────────────────────────

function PresetSelector({ value, onChange, overrides, onEdit }: {
  value: string
  onChange: (v: string) => void
  overrides: Record<string, string>
  onEdit: () => void
}) {
  const isEdited = value !== "Custom (paste my own)" && overrides[value] !== undefined
  return (
    <div className="mb-3">
      <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">System Instruction Preset</label>
      <div className="flex gap-2">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-[#2C2C2E] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#C8A96E]">
          {Object.keys(PRESETS).map((k) => <option key={k}>{k}</option>)}
        </select>
        {value !== "Custom (paste my own)" && (
          <button onClick={onEdit}
            className={`px-3 py-1.5 text-xs rounded border transition-colors flex-shrink-0 ${isEdited ? "border-[#C8A96E] text-[#C8A96E] bg-[#2C2C2E] hover:bg-[#3a3a2e]" : "border-gray-700 text-gray-400 bg-[#2C2C2E] hover:border-gray-500"}`}>
            {isEdited ? "✎ Edited" : "✎ Edit"}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Preset editor modal ──────────────────────────────────────────────────────

function PresetEditorModal({ presetKey, initialText, onSave, onClose }: {
  presetKey: string
  initialText: string
  onSave: (text: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initialText)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1C1C1E] border border-gray-700 rounded-xl p-5 w-full max-w-2xl max-h-[85vh] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white truncate">{presetKey}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none ml-4">✕</button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          className="w-full bg-[#141416] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none font-mono flex-1"
        />
        <div className="flex gap-2 justify-between">
          <button onClick={() => setDraft(PRESETS[presetKey])}
            className="text-xs px-3 py-1.5 bg-[#2C2C2E] border border-gray-700 text-gray-500 rounded hover:border-gray-500 hover:text-gray-300 transition-colors">
            Reset to default
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-sm px-4 py-1.5 bg-[#2C2C2E] border border-gray-700 text-gray-400 rounded hover:border-gray-500 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="text-sm px-5 py-1.5 bg-[#C8A96E] hover:bg-[#d4b87a] text-black font-bold rounded transition-colors disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Image drop zone ─────────────────────────────────────────────────────────

function ImageZone({ images, onAdd, onRemove, max = 6 }: {
  images: File[]; onAdd: (f: File[]) => void; onRemove: (i: number) => void; max?: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [previews, setPreviews] = useState<string[]>([])

  const add = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, max - images.length)
    if (!arr.length) return
    const urls = await Promise.all(arr.map(toDataURL))
    setPreviews(p => [...p, ...urls])
    onAdd(arr)
  }, [images.length, max, onAdd])

  return (
    <div className="mb-3">
      <div onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => ref.current?.click()}
        className="border-2 border-dashed border-gray-700 hover:border-[#C8A96E] rounded-lg p-4 text-center cursor-pointer transition-colors">
        <p className="text-gray-500 text-sm">Drop images here or click to select ({images.length}/{max})</p>
        <input ref={ref} type="file" multiple accept="image/*" className="hidden"
          onChange={(e) => e.target.files && add(e.target.files)} />
      </div>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {previews.map((src, i) => (
            <div key={i} className="relative group">
              <img src={src} className="w-16 h-16 object-cover rounded border border-gray-700" />
              <button onClick={() => { setPreviews(p => p.filter((_, j) => j !== i)); onRemove(i) }}
                className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-xs items-center justify-center hidden group-hover:flex">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Searchable autocomplete ──────────────────────────────────────────────────

function Autocomplete({ value, onChange, options, placeholder, accentColor = "#C8A96E" }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  accentColor?: string
}) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState(value)
  const containerRef          = useRef<HTMLDivElement>(null)

  const filtered = query.length < 1
    ? options.slice(0, 40)
    : options.filter(o => o.toLowerCase().includes(query.toLowerCase())).slice(0, 40)

  function select(opt: string) {
    onChange(opt)
    setQuery(opt)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="flex-1 bg-[#2C2C2E] border border-gray-700 rounded-l px-3 py-2 text-sm text-gray-200 focus:outline-none"
          style={{ borderColor: query ? accentColor + "66" : "" }}
        />
        <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
          className="px-2 bg-[#2C2C2E] border border-l-0 border-gray-700 rounded-r text-gray-500 text-xs">▼</button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full bg-[#2C2C2E] border border-gray-700 rounded mt-0.5 max-h-48 overflow-y-auto shadow-xl">
          {filtered.map(opt => (
            <button key={opt} type="button" onMouseDown={() => select(opt)}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-[#3A3A3C] transition-colors">
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({ model }: { model: string }) {
  const [preset, setPreset]      = useState(Object.keys(PRESETS)[1])
  const [custom, setCustom]      = useState("")
  const [images, setImages]      = useState<File[]>([])
  const [message, setMessage]    = useState("")
  const [history, setHistory]    = useState<ChatMessage[]>([])
  const [apiHistory, setApiHist] = useState<{ role: "user"|"model"; parts: { text: string }[] }[]>([])
  const [loading, setLoading]    = useState(false)
  const [error, setError]        = useState<string | null>(null)
  const [copied, setCopied]      = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [editOpen, setEditOpen]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/auction-ai/presets").then(r => r.json()).then(setOverrides).catch(() => {})
  }, [])

  const systemInstruction = preset === "Custom (paste my own)" ? custom : (overrides[preset] ?? PRESETS[preset])

  async function savePreset(text: string) {
    await fetch("/api/auction-ai/presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: preset, instruction: text }),
    })
    setOverrides(prev => ({ ...prev, [preset]: text }))
    setEditOpen(false)
  }

  async function send() {
    if (!message.trim() && !images.length) return
    setLoading(true); setError(null)
    const imgUrls = await Promise.all(images.map(toDataURL))
    const userDisplay: ChatMessage = { role: "user", text: message, images: imgUrls }
    setHistory(h => [...h, userDisplay])

    try {
      const fd = new FormData()
      fd.append("message", message)
      fd.append("systemInstruction", systemInstruction)
      fd.append("history", JSON.stringify(apiHistory))
      fd.append("model", model)
      images.forEach(img => fd.append("images", img, img.name))

      const res  = await fetch("/api/auction-ai/chat", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)

      setHistory(h => [...h, { role: "model", text: json.reply }])
      setApiHist(h => [
        ...h,
        { role: "user",  parts: [{ text: message }] },
        { role: "model", parts: [{ text: json.reply }] },
      ])
      setMessage(""); setImages([])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
    } catch (e: any) {
      setError(e.message)
      setHistory(h => h.slice(0, -1))
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-lg font-semibold text-white mb-3">Chat Window</h2>
      <PresetSelector value={preset} onChange={setPreset} overrides={overrides} onEdit={() => setEditOpen(true)} />
      {editOpen && <PresetEditorModal presetKey={preset} initialText={overrides[preset] ?? PRESETS[preset]} onSave={savePreset} onClose={() => setEditOpen(false)} />}
      {preset === "Custom (paste my own)" && (
        <textarea value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder="Paste your system instruction here…" rows={3}
          className="w-full bg-[#2C2C2E] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#C8A96E] mb-3 resize-none" />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto bg-[#141416] rounded-lg border border-gray-800 p-4 mb-3 space-y-3">
        {history.length === 0 && (
          <p className="text-gray-600 text-sm text-center py-10">Upload lot images and describe what you need — Gemini will generate a professional catalogue entry.</p>
        )}
        {history.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] rounded-lg px-4 py-3 ${msg.role === "user" ? "bg-[#2C2C2E] text-gray-200" : "bg-[#1a1a1e] border border-[#C8A96E]/25 text-gray-100"}`}>
              {msg.images?.length ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.images.map((src, j) => <img key={j} src={src} className="w-14 h-14 object-cover rounded" />)}
                </div>
              ) : null}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</p>
              {msg.role === "model" && (
                <button onClick={() => { navigator.clipboard.writeText(msg.text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                  className="mt-2 text-xs text-[#C8A96E] hover:underline">
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
      <ImageZone images={images} onAdd={f => setImages(i => [...i, ...f])} onRemove={idx => setImages(i => i.filter((_, j) => j !== idx))} max={6} />

      <div className="flex gap-2">
        <textarea value={message} onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Describe the lot or ask a question… (Enter to send)"
          rows={2}
          className="flex-1 bg-[#2C2C2E] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none" />
        <div className="flex flex-col gap-1.5">
          <button onClick={send} disabled={loading || (!message.trim() && !images.length)}
            className="px-5 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
            {loading ? "…" : "Send"}
          </button>
          <button onClick={() => { setHistory([]); setApiHist([]) }}
            className="px-5 py-1.5 bg-[#2C2C2E] border border-gray-700 text-gray-400 text-xs rounded hover:border-gray-500">
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Batch Run Tab ────────────────────────────────────────────────────────────

function BatchTab({ model }: { model: string }) {
  const [preset,     setPreset]   = useState(Object.keys(PRESETS)[1])
  const [custom,     setCustom]   = useState("")
  const [lots,       setLots]     = useState<Record<string, File[]>>({})
  const [overrides,  setOverrides] = useState<Record<string, string>>({})
  const [editOpen,   setEditOpen]  = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results,  setResults]  = useState<BatchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(0)
  const [log,      setLog]      = useState<string[]>([])
  const logRef     = useRef<HTMLDivElement>(null)
  const folderRef  = useRef<HTMLInputElement>(null)
  const sortRef    = useRef<HTMLInputElement>(null)
  const cancelRef  = useRef(false)
  const pauseRef   = useRef(false)
  const [paused,       setPaused]       = useState(false)
  const [auctionCode,  setAuctionCode]  = useState("")
  const [savedLots,    setSavedLots]    = useState<Set<string>>(new Set())
  const [savedRunId,   setSavedRunId]   = useState<string | null>(null)
  const [runList,      setRunList]      = useState<{ id: string; code: string; _count: { lots: number } }[]>([])

  useEffect(() => {
    fetch("/api/auction-ai/presets").then(r => r.json()).then(setOverrides).catch(() => {})
    fetch("/api/auction-ai/runs").then(r => r.json()).then(setRunList).catch(() => {})
  }, [])

  // When auction code changes, look up existing saved lots for that run
  useEffect(() => {
    const code = auctionCode.trim().toUpperCase()
    if (!code) { setSavedLots(new Set()); setSavedRunId(null); return }
    const match = runList.find(r => r.code === code)
    if (!match) { setSavedLots(new Set()); setSavedRunId(null); return }
    setSavedRunId(match.id)
    fetch(`/api/auction-ai/runs/${match.id}`)
      .then(r => r.json())
      .then((run: any) => {
        if (!run?.lots) return
        setSavedLots(new Set(run.lots.map((l: any) => l.lot)))
      })
      .catch(() => {})
  }, [auctionCode, runList])

  const systemInstruction = preset === "Custom (paste my own)" ? custom : (overrides[preset] ?? PRESETS[preset])

  async function savePreset(text: string) {
    await fetch("/api/auction-ai/presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: preset, instruction: text }),
    })
    setOverrides(prev => ({ ...prev, [preset]: text }))
    setEditOpen(false)
  }
  const lotNames           = Object.keys(lots).sort()
  const selectedNames      = lotNames.filter(n => selected.has(n))
  const total              = selectedNames.length

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog(l => [...l, `[${ts}]  ${msg}`])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  // Load pre-sorted subfolders
  function onFolderFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    const map: Record<string, File[]> = {}
    for (const file of Array.from(e.target.files)) {
      const parts = ((file as any).webkitRelativePath as string | undefined)?.split("/") ?? [file.name]
      const lot = parts.length > 1 ? parts[parts.length - 2] : "Default"
      if (!file.type.startsWith("image/")) continue
      if (!map[lot]) map[lot] = []
      if (map[lot].length < 24) map[lot].push(file)
    }
    const names = Object.keys(map)
    const autoSkipped = names.filter(n => savedLots.has(n))
    setLots(map); setSelected(new Set(names.filter(n => !savedLots.has(n)))); setResults([]); setLog([])
    addLog(`Loaded ${names.length} lot folders  ·  ${Object.values(map).reduce((s,f)=>s+f.length,0)} images total${autoSkipped.length ? `  ·  ${autoSkipped.length} already saved (auto-deselected)` : ""}`)
  }

  // Sort flat folder by filename: everything before the first underscore = lot name
  // e.g. R00001_1.jpg → lot "R00001"  (matches Python app logic)
  function onSortFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/"))
    if (!files.length) return
    setLog([]); setResults([])
    addLog(`Sorting ${files.length} images by filename…`)

    const map: Record<string, File[]> = {}
    let sorted = 0, skipped = 0

    for (const file of files) {
      const nameNoExt = file.name.replace(/\.[^.]+$/, "")
      const lot = nameNoExt.split("_")[0].trim()
      if (!lot) { skipped++; continue }
      sorted++
      if (!map[lot]) map[lot] = []
      if (map[lot].length < 24) map[lot].push(file)
    }

    const names = Object.keys(map).sort()
    const autoSkipped = names.filter(n => savedLots.has(n))
    setLots(map); setSelected(new Set(names.filter(n => !savedLots.has(n))))
    addLog(`Done — ${names.length} lots, ${sorted} images sorted, ${skipped} skipped${autoSkipped.length ? `  ·  ${autoSkipped.length} already saved (auto-deselected)` : ""}`)
  }

  function toggleLot(name: string) {
    setSelected(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
  }
  function selectAll()  { setSelected(new Set(lotNames)) }
  function selectNone() { setSelected(new Set()) }

  function cancel() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
  }

  function togglePause() {
    const next = !pauseRef.current
    pauseRef.current = next
    setPaused(next)
    addLog(next ? "⏸ Paused — will stop after current lot finishes" : "▶ Resuming…")
  }

  async function run() {
    if (!selectedNames.length) return
    cancelRef.current = false
    pauseRef.current  = false
    setPaused(false)
    setLoading(true); setResults([]); setDone(0)
    setLog([])
    addLog(`Starting batch run — ${selectedNames.length} lots  ·  Model: ${model}  ·  Instruction: ${preset}`)
    if (auctionCode.trim()) addLog(`💾 Saving to auction: ${auctionCode.trim().toUpperCase()}`)
    const all: BatchResult[] = []

    for (let i = 0; i < selectedNames.length; i++) {
      if (cancelRef.current) {
        addLog(`⛔ Cancelled after ${i} / ${selectedNames.length} lots`)
        break
      }
      const lot   = selectedNames[i]
      const files = lots[lot]
      setDone(i)
      if (savedLots.has(lot)) {
        addLog(`⏭ ${lot} — already saved, skipping`)
        all.push({ lot, description: "", estimate: "", status: "SKIPPED" })
        continue
      }
      addLog(`Processing ${i + 1} / ${selectedNames.length}  ·  ${lot}  (${files.length} image${files.length !== 1 ? "s" : ""})`)

      try {
        const fd = new FormData()
        fd.append("systemInstruction", systemInstruction)
        fd.append("model", model)
        files.forEach((f, j) => fd.append(`lot_${lot}_image_${j}`, f, f.name))

        const res  = await fetch("/api/auction-ai/batch", { method: "POST", body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? res.statusText)
        all.push(...json.results)
        // Save to DB if auction code provided
        if (auctionCode.trim()) {
          const r = json.results[0]
          if (r?.status === "OK") {
            await fetch("/api/auction-ai/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: auctionCode.trim().toUpperCase(), preset, lot: r.lot, description: r.description, estimate: r.estimate }),
            })
            addLog(`✓ ${lot} — OK  ·  saved`)
          } else {
            addLog(`✓ ${lot} — OK`)
          }
        } else {
          addLog(`✓ ${lot} — OK`)
        }
      } catch (e: any) {
        all.push({ lot, description: "", estimate: "", status: "FAILED", error: e.message })
        addLog(`✗ ${lot} — FAILED: ${e.message}`)
      }
      setResults([...all])

      // Wait while paused (poll every 500ms)
      if (pauseRef.current) {
        addLog(`⏸ Paused after ${lot} — click Resume to continue`)
        while (pauseRef.current && !cancelRef.current) {
          await new Promise(r => setTimeout(r, 500))
        }
        if (!cancelRef.current) addLog("▶ Resumed")
      }
    }

    if (!cancelRef.current) {
      setDone(selectedNames.length)
      const ok   = all.filter(r => r.status === "OK").length
      const fail = all.filter(r => r.status !== "OK").length
      addLog(`Run complete — ${ok} OK, ${fail} failed`)
    }
    setLoading(false)
  }

  function exportXlsx() {
    const now = new Date().toISOString()
    const rows = results.filter(r => r.status === "OK").map(r => {
      const { low, high } = parseEstimate(r.estimate)
      return { Folder: r.lot, Description: r.description, Estimate: r.estimate, "Estimate Low": low, "Estimate High": high, Status: r.status, Updated: now }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [{ wch: 16 }, { wch: 70 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 26 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Descriptions")
    XLSX.writeFile(wb, "auction_ai_results.xlsx")
  }

  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="flex flex-col h-full gap-3">
      <h2 className="text-lg font-semibold text-white">Batch Run</h2>

      <PresetSelector value={preset} onChange={setPreset} overrides={overrides} onEdit={() => setEditOpen(true)} />
      {editOpen && <PresetEditorModal presetKey={preset} initialText={overrides[preset] ?? PRESETS[preset]} onSave={savePreset} onClose={() => setEditOpen(false)} />}
      {preset === "Custom (paste my own)" && (
        <textarea value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder="Paste your system instruction here…" rows={3}
          className="w-full bg-[#2C2C2E] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#C8A96E] resize-none" />
      )}

      {/* ── Auction Code ── */}
      <div>
        <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">
          Auction Code <span className="normal-case text-gray-600">(optional — saves results for later retrieval)</span>
        </label>
        <Autocomplete
          value={auctionCode}
          onChange={v => setAuctionCode(v.replace(/\s+\(\d+ lots\)$/, "").toUpperCase())}
          options={runList.map(r => `${r.code}  (${r._count.lots} lots)`)}
          placeholder="Select existing or type new code…"
        />
        {auctionCode && !runList.find(r => r.code === auctionCode.trim().toUpperCase()) && (
          <p className="text-xs text-gray-600 mt-1">New run — lots will be saved under this code</p>
        )}
        {savedLots.size > 0 && (
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs text-amber-400">{savedLots.size} lot{savedLots.size !== 1 ? "s" : ""} already saved in this run</span>
            <button
              onClick={() => {
                const inBoth = [...savedLots].filter(l => selected.has(l))
                if (inBoth.length > 0) {
                  // deselect all saved lots
                  setSelected(s => new Set([...s].filter(l => !savedLots.has(l))))
                } else {
                  // all already deselected — re-add them back
                  setSelected(s => new Set([...s, ...savedLots].filter(l => lotNames.includes(l))))
                }
              }}
              className="text-xs px-2.5 py-0.5 bg-[#2C2C2E] border border-amber-600 text-amber-400 rounded hover:bg-amber-900/30 transition-colors">
              ⏭ Skip Saved
            </button>
          </div>
        )}
      </div>

      {/* ── Step 1: Sort (optional) ── */}
      <div className="bg-[#2C2C2E] border border-gray-700 rounded-lg p-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Step 1 — Sort flat folder by filename (optional)</p>
        <div onClick={() => sortRef.current?.click()}
          className="border border-dashed border-gray-600 hover:border-green-500 rounded-lg px-4 py-3 text-center cursor-pointer transition-colors">
          <p className="text-gray-300 text-sm font-medium">▦ Sort images by filename (e.g. R00001_1.jpg)</p>
          <p className="text-gray-600 text-xs mt-0.5">Groups by the part before the first underscore — R00001_1.jpg → lot R00001</p>
          <input ref={sortRef} type="file" multiple accept="image/*" className="hidden" onChange={onSortFiles} />
        </div>
      </div>

      {/* ── Step 2: Load subfolders ── */}
      <div className="bg-[#2C2C2E] border border-gray-700 rounded-lg p-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Step 2 — Load lot subfolders</p>
        <div onClick={() => folderRef.current?.click()}
          className="border border-dashed border-gray-600 hover:border-[#C8A96E] rounded-lg px-4 py-3 text-center cursor-pointer transition-colors">
          <p className="text-gray-300 text-sm font-medium">📂 {lotNames.length > 0 ? `${lotNames.length} lots loaded — click to reload` : "Select folder"}</p>
          <p className="text-gray-600 text-xs mt-0.5">Each sub-folder = one lot (up to 24 images each)</p>
          <input ref={folderRef} type="file" multiple className="hidden" {...({ webkitdirectory: "" } as any)} onChange={onFolderFiles} />
        </div>
      </div>

      {/* ── Lot list ── */}
      {lotNames.length > 0 && (
        <div className="flex flex-col min-h-0" style={{ maxHeight: "220px" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-400">
              <span className="text-[#C8A96E] font-semibold">{selected.size}</span>
              {" / "}{lotNames.length} lots selected
              {" · "}{Object.values(lots).reduce((s,f)=>s+f.length,0)} images
            </span>
            <div className="flex gap-1.5">
              <button onClick={selectAll}  className="text-xs px-2 py-0.5 bg-[#1C1C1E] border border-gray-700 text-gray-400 rounded hover:border-gray-500">All</button>
              <button onClick={selectNone} className="text-xs px-2 py-0.5 bg-[#1C1C1E] border border-gray-700 text-gray-400 rounded hover:border-gray-500">None</button>
              <button onClick={() => setSelected(s => { const n = new Set(s); results.filter(r => r.status === "OK").forEach(r => n.delete(r.lot)); return n })}
                className="text-xs px-2 py-0.5 bg-[#1C1C1E] border border-gray-700 text-gray-400 rounded hover:border-gray-500" title="Deselect lots that already have an OK result">Skip Done</button>
            </div>
          </div>
          <div className="overflow-y-auto rounded border border-gray-800 bg-[#141416] flex-1">
            {lotNames.map(name => {
              const checked  = selected.has(name)
              const imgCount = lots[name].length
              const result   = results.find(r => r.lot === name)
              return (
                <div key={name} onClick={() => !loading && toggleLot(name)}
                  className={`flex items-center gap-3 px-3 py-2 border-b border-gray-800 last:border-0 cursor-pointer transition-colors ${checked ? "hover:bg-[#2C2C2E]" : "opacity-40 hover:opacity-60"}`}>
                  <div className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center border ${checked ? "bg-[#C8A96E] border-[#C8A96E]" : "border-gray-600"}`}>
                    {checked && <span className="text-black text-xs font-bold leading-none">✓</span>}
                  </div>
                  <span className="flex-1 text-xs text-gray-200 font-mono truncate">{name}</span>
                  <span className="text-xs text-gray-600 flex-shrink-0">{imgCount}img</span>
                  {result && <span className={`text-xs font-bold flex-shrink-0 ${result.status === "OK" ? "text-green-400" : "text-red-400"}`}>{result.status}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Run log ── */}
      {log.length > 0 && (
        <div ref={logRef} className="overflow-y-auto rounded border border-gray-800 bg-[#0d0d0f] px-3 py-2 font-mono text-xs text-[#C8C8D0] flex-shrink-0" style={{ maxHeight: "160px" }}>
          {log.map((line, i) => (
            <p key={i} className={line.includes("✓") ? "text-green-400" : line.includes("✗") || line.includes("ERROR") ? "text-red-400" : line.includes("complete") || line.includes("complete") ? "text-[#C8A96E]" : ""}>{line}</p>
          ))}
        </div>
      )}

      {/* ── Progress bar ── */}
      {loading && (
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-[#C8A96E]">{done} / {total} lots complete</span>
            <span className="text-xs text-gray-500">{pct}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div className="bg-[#C8A96E] h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button onClick={run} disabled={loading || !total}
          className="px-6 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
          {loading ? `Running ${done} / ${total}…` : `Start Batch (${total} lots)`}
        </button>
        {loading && (
          <button onClick={togglePause}
            className={`px-4 py-2 border text-sm font-semibold rounded transition-colors ${paused ? "bg-green-900 hover:bg-green-800 border-green-700 text-green-300" : "bg-yellow-900 hover:bg-yellow-800 border-yellow-700 text-yellow-300"}`}>
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        )}
        {loading && (
          <button onClick={cancel}
            className="px-4 py-2 bg-red-900 hover:bg-red-800 border border-red-700 text-red-300 text-sm font-semibold rounded transition-colors">
            ✕ Cancel
          </button>
        )}
        {results.length > 0 && !loading && (
          <button onClick={exportXlsx}
            className="px-4 py-2 bg-[#2C2C2E] border border-gray-700 hover:border-[#C8A96E] text-gray-300 text-sm rounded transition-colors">
            ⬇ Export to Excel
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Barcode Sorter Tab ───────────────────────────────────────────────────────

function BarcodeTab() {
  const [files, setFiles]     = useState<File[]>([])
  const [results, setResults] = useState<{ name: string; barcode: string; type: string; folder: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function scan() {
    if (!files.length) return
    setLoading(true); setError(null)
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser" as any)
      const reader = new (BrowserMultiFormatReader as any)()
      const out: typeof results = []

      for (const file of files) {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.src = url
        await new Promise((r) => { img.onload = r; img.onerror = r })
        let barcode = "—", folder = "_UNSORTED", type = "Unknown"
        try {
          const r   = await reader.decodeFromImageElement(img)
          barcode   = r.getText()
          const isC = /^C\d{6}/.test(barcode)
          const isL = /^L\d{6}/.test(barcode)
          type   = isC ? "Customer" : isL ? "Lot" : "Unknown"
          folder = isC ? `Customers/${barcode}` : isL ? `Lots/${barcode}` : "_UNSORTED"
        } catch { /* unreadable */ }
        URL.revokeObjectURL(url)
        out.push({ name: file.name, barcode, type, folder })
      }
      setResults(out)
    } catch (e: any) {
      setError("Barcode library failed to load. Run: npm install @zxing/browser  — " + e.message)
    }
    setLoading(false)
  }

  async function downloadZip() {
    const JSZip = (await import("jszip")).default
    const zip   = new JSZip()
    for (let i = 0; i < files.length; i++) {
      const buf = await files[i].arrayBuffer()
      zip.file(`${results[i].folder}/${files[i].name}`, buf)
    }
    const blob = await zip.generateAsync({ type: "blob" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "sorted_barcodes.zip"
    a.click()
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Barcode Sorter</h2>
      <p className="text-gray-500 text-sm mb-4">Upload barcode header images — decodes each barcode and sorts files into customer or lot folders for download.</p>

      <div onClick={() => document.getElementById("bc-input")?.click()}
        className="border-2 border-dashed border-gray-700 hover:border-[#C8A96E] rounded-lg p-6 text-center cursor-pointer transition-colors mb-4">
        <p className="text-gray-400 text-sm">Click or drop barcode images here</p>
        <p className="text-gray-600 text-xs mt-1">{files.length} file{files.length !== 1 ? "s" : ""} selected</p>
        <input id="bc-input" type="file" multiple accept="image/*" className="hidden"
          onChange={(e) => { if (e.target.files) { setFiles(Array.from(e.target.files)); setResults([]) } }} />
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <button onClick={scan} disabled={loading || !files.length}
        className="mb-4 px-6 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors disabled:opacity-40">
        {loading ? "Scanning…" : "Scan Barcodes"}
      </button>

      {results.length > 0 && (
        <>
          <div className="overflow-x-auto rounded border border-gray-800 mb-3">
            <table className="w-full text-sm">
              <thead className="bg-[#141416] text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">File</th>
                  <th className="px-4 py-2 text-left">Barcode</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Folder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {results.map((r, i) => (
                  <tr key={i} className="hover:bg-[#141416]">
                    <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-[160px]">{r.name}</td>
                    <td className="px-4 py-2 text-[#C8A96E] font-mono text-xs">{r.barcode}</td>
                    <td className="px-4 py-2 text-gray-300 text-xs">{r.type}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{r.folder}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={downloadZip}
            className="px-4 py-2 bg-[#2C2C2E] border border-gray-700 hover:border-[#C8A96E] text-gray-300 text-sm rounded transition-colors">
            ⬇ Download Sorted ZIP
          </button>
        </>
      )}
    </div>
  )
}

// ─── Description Copier Tab ───────────────────────────────────────────────────

function CopierTab() {
  const [rows, setRows]         = useState<{ folder: string; description: string; estimate: string }[]>([])
  const [idx, setIdx]           = useState(0)
  const [copiedType, setCopied] = useState<"desc" | "both" | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [jumpQuery, setJumpQuery] = useState("")
  const [jumpOpen, setJumpOpen]   = useState(false)

  useEffect(() => {
    const preload = localStorage.getItem("copier_preload")
    if (preload) {
      try {
        const data = JSON.parse(preload)
        setRows(data.map((r: any) => ({
          folder:      String(r.Folder ?? ""),
          description: String(r.Description ?? ""),
          estimate:    String(r.Estimate ?? ""),
        })).filter((r: any) => r.description))
        setIdx(0)
        localStorage.removeItem("copier_preload")
      } catch {}
    }
  }, [])

  function loadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb   = XLSX.read(ev.target?.result, { type: "binary" })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json<any>(ws)
        setRows(data.map((r: any) => ({
          folder:      String(r.Folder ?? r.folder ?? r.Lot ?? ""),
          description: String(r.Description ?? r.description ?? ""),
          estimate:    String(r.Estimate ?? r.estimate ?? ""),
        })).filter(r => r.description))
        setIdx(0); setError(null); setJumpQuery("")
      } catch (e: any) { setError("Failed to read Excel: " + e.message) }
    }
    reader.readAsBinaryString(file)
  }

  const row = rows[idx]

  function copyDesc() {
    if (!row) return
    navigator.clipboard.writeText(row.description)
    setCopied("desc"); setTimeout(() => setCopied(null), 1500)
  }

  function copyBoth() {
    if (!row) return
    navigator.clipboard.writeText(row.estimate ? `${row.description}\n${row.estimate}` : row.description)
    setCopied("both"); setTimeout(() => setCopied(null), 1500)
  }

  function jumpTo(i: number) {
    setIdx(i)
    setJumpQuery(rows[i]?.folder ?? "")
    setJumpOpen(false)
  }

  const filteredJump = rows
    .map((r, i) => ({ ...r, i }))
    .filter(r => r.folder.toLowerCase().includes(jumpQuery.toLowerCase()))
    .slice(0, 50)

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Description Copier</h2>
      <label className="block mb-4">
        <span className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Load Excel results file</span>
        <input type="file" accept=".xlsx,.xls" onChange={loadFile}
          className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-4 file:rounded file:border-0 file:bg-[#C8A96E] file:text-black file:text-sm file:font-bold hover:file:bg-[#d4b87a] cursor-pointer" />
      </label>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {rows.length > 0 && (
        <>
          {/* Navigation row */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              className="px-3 py-1.5 bg-[#2C2C2E] border border-gray-700 text-gray-300 rounded text-sm disabled:opacity-40 hover:border-gray-500">← Prev</button>
            <span className="text-sm text-gray-400 tabular-nums">{idx + 1} / {rows.length}</span>
            <button onClick={() => setIdx(i => Math.min(rows.length - 1, i + 1))} disabled={idx === rows.length - 1}
              className="px-3 py-1.5 bg-[#2C2C2E] border border-gray-700 text-gray-300 rounded text-sm disabled:opacity-40 hover:border-gray-500">Next →</button>

            {/* Jump to lot */}
            <div className="relative ml-auto">
              <div className="flex items-center">
                <span className="text-xs text-gray-500 mr-2 whitespace-nowrap">Jump to lot:</span>
                <input
                  value={jumpQuery}
                  onChange={e => { setJumpQuery(e.target.value); setJumpOpen(true) }}
                  onFocus={() => setJumpOpen(true)}
                  onBlur={() => setTimeout(() => setJumpOpen(false), 150)}
                  placeholder="Search lot…"
                  className="w-36 bg-[#2C2C2E] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#C8A96E]"
                />
              </div>
              {jumpOpen && filteredJump.length > 0 && (
                <div className="absolute right-0 z-50 w-56 bg-[#2C2C2E] border border-gray-700 rounded mt-0.5 max-h-56 overflow-y-auto shadow-xl">
                  {filteredJump.map(r => (
                    <button key={r.i} onMouseDown={() => jumpTo(r.i)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[#3A3A3C] ${r.i === idx ? "text-[#C8A96E] font-semibold" : "text-gray-200"}`}>
                      {r.folder || `Row ${r.i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Card */}
          {row && (
            <div className="bg-[#141416] border border-gray-800 rounded-lg p-5 mb-4">
              {row.folder && <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">{row.folder}</p>}
              <p className="text-gray-200 text-sm leading-relaxed">{row.description}</p>
              {row.estimate && <p className="text-[#C8A96E] text-sm font-semibold mt-2">{row.estimate}</p>}
            </div>
          )}

          {/* Copy buttons */}
          <div className="flex gap-3">
            <button onClick={copyDesc}
              className="px-5 py-2 bg-[#2C2C2E] border border-[#C8A96E] hover:bg-[#C8A96E] hover:text-black text-[#C8A96E] text-sm font-bold rounded transition-colors">
              {copiedType === "desc" ? "✓ Copied!" : "Copy Description"}
            </button>
            <button onClick={copyBoth}
              className="px-5 py-2 bg-[#C8A96E] hover:bg-[#d4b87a] text-black text-sm font-bold rounded transition-colors">
              {copiedType === "both" ? "✓ Copied!" : "Description + Estimate"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Saved Runs Tab ───────────────────────────────────────────────────────────

type RunSummary = { id: string; code: string; preset: string; updatedAt: string; _count: { lots: number } }
type RunDetail  = { id: string; code: string; preset: string; updatedAt: string; lots: { id: string; lot: string; description: string; estimate: string; createdAt: string }[] }

function SavedRunsTab() {
  const [runs,       setRuns]       = useState<RunSummary[]>([])
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [detail,     setDetail]     = useState<RunDetail | null>(null)
  const [search,     setSearch]     = useState("")
  const [loading,    setLoading]    = useState(false)
  const [deleting,   setDeleting]   = useState<string | null>(null)

  useEffect(() => { loadRuns() }, [])

  async function loadRuns() {
    setLoading(true)
    const r = await fetch("/api/auction-ai/runs")
    const j = await r.json()
    setRuns(j)
    setLoading(false)
  }

  async function expand(run: RunSummary) {
    if (expanded === run.id) { setExpanded(null); setDetail(null); return }
    setExpanded(run.id)
    const r = await fetch(`/api/auction-ai/runs/${run.id}`)
    setDetail(await r.json())
  }

  async function deleteRun(id: string) {
    if (!confirm("Delete this auction run and all its lots?")) return
    setDeleting(id)
    await fetch("/api/auction-ai/runs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
    setRuns(r => r.filter(x => x.id !== id))
    if (expanded === id) { setExpanded(null); setDetail(null) }
    setDeleting(null)
  }

  async function deleteLot(lotId: string) {
    await fetch(`/api/auction-ai/runs/${lotId}`, { method: "DELETE" })
    setDetail(d => d ? { ...d, lots: d.lots.filter(l => l.id !== lotId) } : d)
    setRuns(r => r.map(x => x.id === detail?.id ? { ...x, _count: { lots: x._count.lots - 1 } } : x))
  }

  function exportRun(run: RunDetail) {
    const rows = run.lots.map(l => {
      const { low, high } = parseEstimate(l.estimate)
      return { Folder: l.lot, Description: l.description, Estimate: l.estimate, "Estimate Low": low, "Estimate High": high, Status: "OK", Updated: new Date(l.createdAt).toISOString() }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [{ wch: 16 }, { wch: 70 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 26 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, run.code)
    XLSX.writeFile(wb, `${run.code}.xlsx`)
  }

  const filtered = runs.filter(r => r.code.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Saved Runs</h2>
        <button onClick={loadRuns} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">↻ Refresh</button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search auction code…"
        className="w-full bg-[#2C2C2E] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#C8A96E] placeholder:text-gray-600" />

      {loading && <p className="text-gray-500 text-sm">Loading…</p>}

      {!loading && filtered.length === 0 && (
        <p className="text-gray-600 text-sm">No saved runs yet. Enter an auction code on the Batch Run tab before running.</p>
      )}

      <div className="flex flex-col gap-2 overflow-y-auto flex-1">
        {filtered.map(run => (
          <div key={run.id} className="bg-[#2C2C2E] border border-gray-700 rounded-lg overflow-hidden">
            {/* ── Run header ── */}
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#3A3A3C] transition-colors" onClick={() => expand(run)}>
              <span className="text-[#C8A96E] font-bold font-mono text-sm flex-1">{run.code}</span>
              <span className="text-xs text-gray-500">{run._count.lots} lots</span>
              <span className="text-xs text-gray-600">{new Date(run.updatedAt).toLocaleDateString("en-GB")}</span>
              <span className="text-xs text-gray-600 truncate max-w-[120px]">{run.preset}</span>
              <button onClick={e => { e.stopPropagation(); deleteRun(run.id) }} disabled={deleting === run.id}
                className="text-xs text-red-500 hover:text-red-400 transition-colors ml-1 flex-shrink-0">
                {deleting === run.id ? "…" : "Delete"}
              </button>
              <span className="text-gray-600 text-xs">{expanded === run.id ? "▲" : "▼"}</span>
            </div>

            {/* ── Expanded lots ── */}
            {expanded === run.id && detail?.id === run.id && (
              <div className="border-t border-gray-700">
                <div className="flex items-center justify-between px-4 py-2 bg-[#1C1C1E]">
                  <span className="text-xs text-gray-500">{detail.lots.length} lots</span>
                  <button onClick={() => exportRun(detail)}
                    className="text-xs px-3 py-1 bg-[#C8A96E] hover:bg-[#d4b87a] text-black font-semibold rounded transition-colors">
                    ⬇ Export to Excel
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {detail.lots.map(l => (
                    <div key={l.id} className="flex items-start gap-3 px-4 py-2.5 border-t border-gray-800 hover:bg-[#2C2C2E] group">
                      <span className="text-xs font-mono text-[#C8A96E] flex-shrink-0 w-20">{l.lot}</span>
                      <span className="text-xs text-gray-300 flex-1 line-clamp-2">{l.description}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0 w-20 text-right">{l.estimate}</span>
                      <button onClick={() => deleteLot(l.id)}
                        className="text-xs text-red-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: string; accent?: string }[] = [
  { id: "chat",      label: "Chat Window",        icon: "💬" },
  { id: "batch",     label: "Batch Run",          icon: "⚡" },
  { id: "runs",      label: "Saved Runs",         icon: "🗂" },
  { id: "barcode",   label: "Barcode Sorter",     icon: "▦"  },
  { id: "copier",    label: "Description Copier", icon: "📋" },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-3-flash-preview"

export default function AuctionAIPage() {
  const [tab,       setTab]       = useState<Tab>("chat")
  const [model,     setModel]     = useState(DEFAULT_MODEL)
  const [modelList, setModelList] = useState<string[]>([DEFAULT_MODEL])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get("tab") as Tab | null
    if (t && TABS.some(x => x.id === t)) setTab(t)
  }, [])

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-[calc(100vh-48px)] bg-[#1C1C1E] text-white overflow-hidden">

      <aside className="w-52 bg-[#141416] border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-800">
          <p className="text-white font-bold text-base tracking-wide">AUCTION AI</p>
          <p className="text-[#C8A96E] text-xs mt-0.5 tracking-widest uppercase">Vectis</p>
        </div>
        <div className="flex-1 px-3 py-4 space-y-0.5">
          {TABS.map((t) => {
            const accent = t.accent ?? "#C8A96E"
            const active = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-sm font-medium transition-colors text-left"
                style={{
                  background: active ? accent + "1a" : "",
                  color: active ? accent : "#9ca3af",
                  border: active ? `1px solid ${accent}4d` : "1px solid transparent",
                }}>
                <span>{t.icon}</span><span>{t.label}</span>
              </button>
            )
          })}
        </div>
        <div className="px-4 py-3 border-t border-gray-800 space-y-1.5">
          <p className="text-gray-600 text-xs uppercase tracking-wider">Model</p>
          <select value={model} onChange={e => setModel(e.target.value)}
            className="w-full bg-[#2C2C2E] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-[#C8A96E]">
            {modelList.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <div className={tab === "chat"      ? "" : "hidden"}><ChatTab model={model} /></div>
        <div className={tab === "batch"     ? "" : "hidden"}><BatchTab model={model} /></div>
        <div className={tab === "runs"      ? "" : "hidden"}><SavedRunsTab /></div>
        <div className={tab === "barcode"   ? "" : "hidden"}><BarcodeTab /></div>
        <div className={tab === "copier"    ? "" : "hidden"}><CopierTab /></div>
      </main>
    </div>
  )
}
