"use client"

import { useState, useMemo, useTransition } from "react"
import { updateContactDb, updateReceiptDb, updateContainerDb } from "@/lib/actions/databases"

// ── Types ──────────────────────────────────────────────────────────────────

type ContactRow = {
  id: string; name: string; email: string | null; phone: string | null
  notes: string | null; isBuyer: boolean; isSeller: boolean
}
type ReceiptRow = {
  id: string; contactId: string; contactName: string
  commissionRate: number; notes: string | null; status: string; containerCount: number
}
type ContainerRow = {
  id: string; type: string; description: string
  category: string | null; subcategory: string | null
  receiptId: string; contactId: string; contactName: string; lastLocation: string | null
}
type LotRow = {
  id: string; lotNumber: string; title: string
  auctionCode: string; auctionName: string
  vendor: string | null; receipt: string | null; tote: string | null
  category: string | null; subCategory: string | null; status: string
  estimateLow: number | null; estimateHigh: number | null; imageCount: number
}

type Tab = "customers" | "receipts" | "totes" | "lots"

interface Props {
  contacts:   ContactRow[]
  receipts:   ReceiptRow[]
  containers: ContainerRow[]
  lots:       LotRow[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = "text", placeholder }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
    />
  )
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        checked
          ? "border-violet-500 bg-violet-500/20 text-violet-300"
          : "border-gray-700 text-gray-500 hover:border-gray-500"
      }`}
    >
      {label}
    </button>
  )
}

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "green" | "blue" | "amber" | "red" | "violet" }) {
  const styles: Record<string, string> = {
    gray:   "bg-gray-800 text-gray-400",
    green:  "bg-green-900/40 text-green-400",
    blue:   "bg-blue-900/40 text-blue-400",
    amber:  "bg-amber-900/40 text-amber-400",
    red:    "bg-red-900/40 text-red-400",
    violet: "bg-violet-900/40 text-violet-400",
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${styles[color]}`}>
      {children}
    </span>
  )
}

function statusBadge(status: string) {
  if (status === "OPEN" || status === "ENTERED") return <Badge color="green">{status}</Badge>
  if (status === "SOLD" || status === "CLOSED") return <Badge color="blue">{status}</Badge>
  if (status === "WITHDRAWN") return <Badge color="red">{status}</Badge>
  return <Badge>{status}</Badge>
}

// ── Edit Panels ────────────────────────────────────────────────────────────

function ContactEditPanel({ row, onClose, onSaved }: { row: ContactRow; onClose: () => void; onSaved: () => void }) {
  const [name,     setName]     = useState(row.name)
  const [email,    setEmail]    = useState(row.email ?? "")
  const [phone,    setPhone]    = useState(row.phone ?? "")
  const [notes,    setNotes]    = useState(row.notes ?? "")
  const [isBuyer,  setIsBuyer]  = useState(row.isBuyer)
  const [isSeller, setIsSeller] = useState(row.isSeller)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    start(async () => {
      try {
        await updateContactDb(row.id, {
          name: name.trim(), email: email.trim() || undefined,
          phone: phone.trim() || undefined, notes: notes.trim() || undefined,
          isBuyer, isSeller,
        })
        onSaved()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed")
      }
    })
  }

  return (
    <div className="space-y-4">
      <Field label="Name"><Input value={name} onChange={setName} placeholder="Full name" /></Field>
      <Field label="Email"><Input value={email} onChange={setEmail} type="email" placeholder="email@example.com" /></Field>
      <Field label="Phone"><Input value={phone} onChange={setPhone} placeholder="+44..." /></Field>
      <Field label="Notes">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
      </Field>
      <div className="flex gap-2">
        <Toggle label="Buyer"  checked={isBuyer}  onChange={setIsBuyer}  />
        <Toggle label="Seller" checked={isSeller} onChange={setIsSeller} />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Cancel</button>
        <button onClick={save} disabled={pending} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}

function ReceiptEditPanel({ row, onClose, onSaved }: { row: ReceiptRow; onClose: () => void; onSaved: () => void }) {
  const [commission, setCommission] = useState(String(row.commissionRate))
  const [notes,      setNotes]      = useState(row.notes ?? "")
  const [status,     setStatus]     = useState(row.status)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    start(async () => {
      try {
        await updateReceiptDb(row.id, {
          commissionRate: parseFloat(commission) || 0,
          notes: notes.trim() || undefined,
          status,
        })
        onSaved()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#1C1C1E] rounded-lg border border-gray-800 px-4 py-3 text-sm">
        <span className="text-gray-500">Contact: </span>
        <span className="text-gray-200">{row.contactName}</span>
        <span className="text-gray-600 mx-2">·</span>
        <span className="text-gray-500">ID: </span>
        <span className="text-gray-400 font-mono text-xs">{row.id}</span>
      </div>
      <Field label="Commission Rate (%)">
        <Input value={commission} onChange={setCommission} type="number" placeholder="15" />
      </Field>
      <Field label="Status">
        <Select value={status} onChange={setStatus} options={[
          { value: "OPEN", label: "Open" },
          { value: "CLOSED", label: "Closed" },
          { value: "PENDING", label: "Pending" },
        ]} />
      </Field>
      <Field label="Notes">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
      </Field>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Cancel</button>
        <button onClick={save} disabled={pending} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}

function ContainerEditPanel({ row, onClose, onSaved }: { row: ContainerRow; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(row.description)
  const [category,    setCategory]    = useState(row.category ?? "")
  const [subcategory, setSubcategory] = useState(row.subcategory ?? "")
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    start(async () => {
      try {
        await updateContainerDb(row.id, {
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          subcategory: subcategory.trim() || undefined,
        })
        onSaved()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#1C1C1E] rounded-lg border border-gray-800 px-4 py-3 text-sm space-y-1">
        <div><span className="text-gray-500">Contact: </span><span className="text-gray-200">{row.contactName}</span></div>
        <div><span className="text-gray-500">Type: </span><span className="text-gray-400">{row.type}</span></div>
        {row.lastLocation && <div><span className="text-gray-500">Location: </span><span className="text-gray-400 font-mono">{row.lastLocation}</span></div>}
      </div>
      <Field label="Description"><Input value={description} onChange={setDescription} placeholder="Description" /></Field>
      <Field label="Category"><Input value={category} onChange={setCategory} placeholder="e.g. Furniture" /></Field>
      <Field label="Subcategory"><Input value={subcategory} onChange={setSubcategory} placeholder="e.g. Chairs" /></Field>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Cancel</button>
        <button onClick={save} disabled={pending} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}

function LotInfoPanel({ row, onClose }: { row: LotRow; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Auction</span><span className="text-gray-300">{row.auctionCode}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Lot No.</span><span className="text-gray-300 font-mono">{row.lotNumber}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Title</span><span className="text-gray-300 text-right max-w-[60%]">{row.title || "—"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Vendor</span><span className="text-gray-300">{row.vendor || "—"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Receipt</span><span className="text-gray-300">{row.receipt || "—"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Tote</span><span className="text-gray-300 font-mono">{row.tote || "—"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Category</span><span className="text-gray-300">{row.category || "—"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Sub-category</span><span className="text-gray-300">{row.subCategory || "—"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Estimate</span><span className="text-gray-300">{row.estimateLow || row.estimateHigh ? `£${row.estimateLow ?? "?"}–£${row.estimateHigh ?? "?"}` : "—"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Photos</span><span className="text-gray-300">{row.imageCount}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Status</span>{statusBadge(row.status)}</div>
      </div>
      <button onClick={onClose} className="w-full py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Close</button>
    </div>
  )
}

// ── Slide-in drawer ────────────────────────────────────────────────────────

function Drawer({ title, subtitle, open, onClose, children }: {
  title: string; subtitle?: string; open: boolean; onClose: () => void; children: React.ReactNode
}) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={onClose} />
      )}
      <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-[#18181B] border-l border-gray-800 flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none ml-4">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function DatabasesClient({ contacts, receipts, containers, lots }: Props) {
  const [tab, setTab] = useState<Tab>("customers")
  const [search, setSearch] = useState("")

  // Filters
  const [buyerFilter,  setBuyerFilter]  = useState(false)
  const [sellerFilter, setSellerFilter] = useState(false)
  const [receiptStatus, setReceiptStatus] = useState("ALL")
  const [toteType,     setToteType]     = useState("ALL")
  const [lotStatus,    setLotStatus]    = useState("ALL")
  const [lotAuction,   setLotAuction]   = useState("ALL")

  // Edit drawer
  const [editContact,   setEditContact]   = useState<ContactRow | null>(null)
  const [editReceipt,   setEditReceipt]   = useState<ReceiptRow | null>(null)
  const [editContainer, setEditContainer] = useState<ContainerRow | null>(null)
  const [editLot,       setEditLot]       = useState<LotRow | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  function flash() {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  const q = search.toLowerCase().trim()

  // Derived data
  const filteredContacts = useMemo(() => contacts.filter(c => {
    if (buyerFilter  && !c.isBuyer)  return false
    if (sellerFilter && !c.isSeller) return false
    if (!q) return true
    return c.name.toLowerCase().includes(q) || (c.email?.toLowerCase().includes(q) ?? false) || (c.phone?.toLowerCase().includes(q) ?? false)
  }), [contacts, buyerFilter, sellerFilter, q])

  const filteredReceipts = useMemo(() => receipts.filter(r => {
    if (receiptStatus !== "ALL" && r.status !== receiptStatus) return false
    if (!q) return true
    return r.id.toLowerCase().includes(q) || r.contactName.toLowerCase().includes(q)
  }), [receipts, receiptStatus, q])

  const filteredContainers = useMemo(() => containers.filter(c => {
    if (toteType !== "ALL" && c.type !== toteType) return false
    if (!q) return true
    return c.id.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.contactName.toLowerCase().includes(q) || (c.lastLocation?.toLowerCase().includes(q) ?? false)
  }), [containers, toteType, q])

  const filteredLots = useMemo(() => lots.filter(l => {
    if (lotStatus  !== "ALL" && l.status       !== lotStatus)  return false
    if (lotAuction !== "ALL" && l.auctionCode  !== lotAuction) return false
    if (!q) return true
    return (
      l.lotNumber.toLowerCase().includes(q) ||
      l.title.toLowerCase().includes(q) ||
      (l.vendor?.toLowerCase().includes(q) ?? false) ||
      (l.tote?.toLowerCase().includes(q) ?? false) ||
      l.auctionCode.toLowerCase().includes(q)
    )
  }), [lots, lotStatus, lotAuction, q])

  const toteTypes    = useMemo(() => ["ALL", ...Array.from(new Set(containers.map(c => c.type))).sort()], [containers])
  const auctionCodes = useMemo(() => ["ALL", ...Array.from(new Set(lots.map(l => l.auctionCode))).sort()], [lots])
  const lotStatuses  = useMemo(() => ["ALL", ...Array.from(new Set(lots.map(l => l.status))).sort()], [lots])

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "customers", label: "Customers",  count: contacts.length   },
    { key: "receipts",  label: "Receipts",   count: receipts.length   },
    { key: "totes",     label: "Totes",      count: containers.length },
    { key: "lots",      label: "Lots",       count: lots.length       },
  ]

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-100">Databases</h1>
            <p className="text-xs text-gray-500 mt-0.5">Search and manage all records</p>
          </div>
          {savedFlash && <span className="text-sm font-semibold text-violet-400 animate-pulse">✓ Saved</span>}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800 mb-5 overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSearch("") }}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-gray-600">({t.count.toLocaleString()})</span>
            </button>
          ))}
        </div>

        {/* Search + Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={
              tab === "customers" ? "Search name, email, phone…"
              : tab === "receipts" ? "Search ID, contact…"
              : tab === "totes" ? "Search ID, description, contact…"
              : "Search lot no., title, vendor, tote…"
            }
            className="flex-1 min-w-[200px] rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-600"
          />

          {/* Customer filters */}
          {tab === "customers" && (
            <div className="flex gap-2">
              <Toggle label="Buyers only"  checked={buyerFilter}  onChange={setBuyerFilter}  />
              <Toggle label="Sellers only" checked={sellerFilter} onChange={setSellerFilter} />
            </div>
          )}

          {/* Receipt filters */}
          {tab === "receipts" && (
            <select value={receiptStatus} onChange={e => setReceiptStatus(e.target.value)}
              className="rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
              <option value="ALL">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
              <option value="PENDING">Pending</option>
            </select>
          )}

          {/* Tote filters */}
          {tab === "totes" && (
            <select value={toteType} onChange={e => setToteType(e.target.value)}
              className="rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
              {toteTypes.map(t => <option key={t} value={t}>{t === "ALL" ? "All types" : t}</option>)}
            </select>
          )}

          {/* Lot filters */}
          {tab === "lots" && (
            <div className="flex gap-2 flex-wrap">
              <select value={lotAuction} onChange={e => setLotAuction(e.target.value)}
                className="rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
                {auctionCodes.map(a => <option key={a} value={a}>{a === "ALL" ? "All auctions" : a}</option>)}
              </select>
              <select value={lotStatus} onChange={e => setLotStatus(e.target.value)}
                className="rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500">
                {lotStatuses.map(s => <option key={s} value={s}>{s === "ALL" ? "All statuses" : s}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Result count */}
        <p className="text-xs text-gray-600 mb-3">
          {tab === "customers"  ? filteredContacts.length
          : tab === "receipts" ? filteredReceipts.length
          : tab === "totes"    ? filteredContainers.length
          :                      filteredLots.length} results
        </p>

        {/* ── Customers Table ── */}
        {tab === "customers" && (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Roles</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((c, i) => (
                  <tr key={c.id}
                    onClick={() => setEditContact(c)}
                    className={`cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-[#1C1C1E]/30"}`}>
                    <td className="px-4 py-3 text-gray-200 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{c.email ?? <span className="text-gray-700">—</span>}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{c.phone ?? <span className="text-gray-700">—</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {c.isBuyer  && <Badge color="green">Buyer</Badge>}
                        {c.isSeller && <Badge color="blue">Seller</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredContacts.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600 text-sm">No customers found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Receipts Table ── */}
        {tab === "receipts" && (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Commission</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Totes</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map((r, i) => (
                  <tr key={r.id}
                    onClick={() => setEditReceipt(r)}
                    className={`cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-[#1C1C1E]/30"}`}>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{r.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-gray-200">{r.contactName}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{r.commissionRate}%</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{r.containerCount}</td>
                    <td className="px-4 py-3">{statusBadge(r.status)}</td>
                  </tr>
                ))}
                {filteredReceipts.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-sm">No receipts found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Totes Table ── */}
        {tab === "totes" && (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Location</th>
                </tr>
              </thead>
              <tbody>
                {filteredContainers.map((c, i) => (
                  <tr key={c.id}
                    onClick={() => setEditContainer(c)}
                    className={`cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-[#1C1C1E]/30"}`}>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{c.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-gray-200 max-w-[200px] truncate">{c.description}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{c.contactName}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">
                      {c.category ? (
                        <span>{c.category}{c.subcategory ? ` / ${c.subcategory}` : ""}</span>
                      ) : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.lastLocation
                        ? <Badge color="violet">{c.lastLocation}</Badge>
                        : <span className="text-gray-700">—</span>}
                    </td>
                  </tr>
                ))}
                {filteredContainers.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-sm">No totes found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Lots Table ── */}
        {tab === "lots" && (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Lot No.</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Auction</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden lg:table-cell">Vendor</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden lg:table-cell">Tote</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Photos</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((l, i) => (
                  <tr key={l.id}
                    onClick={() => setEditLot(l)}
                    className={`cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-[#1C1C1E]/30"}`}>
                    <td className="px-4 py-3 text-gray-300 font-mono">{l.lotNumber}</td>
                    <td className="px-4 py-3 text-gray-200 max-w-[180px] truncate">{l.title || <span className="text-gray-600">Untitled</span>}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{l.auctionCode}</td>
                    <td className="px-4 py-3 text-gray-400 hidden lg:table-cell">{l.vendor ?? <span className="text-gray-700">—</span>}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono hidden lg:table-cell">{l.tote ?? <span className="text-gray-700">—</span>}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {l.imageCount > 0
                        ? <Badge color="violet">{l.imageCount}</Badge>
                        : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="px-4 py-3">{statusBadge(l.status)}</td>
                  </tr>
                ))}
                {filteredLots.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600 text-sm">No lots found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* ── Edit Drawers ── */}
      <Drawer
        title={editContact?.name ?? ""}
        subtitle="Edit customer"
        open={!!editContact}
        onClose={() => setEditContact(null)}
      >
        {editContact && (
          <ContactEditPanel row={editContact} onClose={() => setEditContact(null)} onSaved={flash} />
        )}
      </Drawer>

      <Drawer
        title={editReceipt ? `Receipt · ${editReceipt.contactName}` : ""}
        subtitle="Edit receipt"
        open={!!editReceipt}
        onClose={() => setEditReceipt(null)}
      >
        {editReceipt && (
          <ReceiptEditPanel row={editReceipt} onClose={() => setEditReceipt(null)} onSaved={flash} />
        )}
      </Drawer>

      <Drawer
        title={editContainer ? editContainer.id.slice(0, 12) : ""}
        subtitle="Edit tote"
        open={!!editContainer}
        onClose={() => setEditContainer(null)}
      >
        {editContainer && (
          <ContainerEditPanel row={editContainer} onClose={() => setEditContainer(null)} onSaved={flash} />
        )}
      </Drawer>

      <Drawer
        title={editLot ? `Lot ${editLot.lotNumber}` : ""}
        subtitle={editLot?.auctionCode}
        open={!!editLot}
        onClose={() => setEditLot(null)}
      >
        {editLot && (
          <LotInfoPanel row={editLot} onClose={() => setEditLot(null)} />
        )}
      </Drawer>
    </div>
  )
}
