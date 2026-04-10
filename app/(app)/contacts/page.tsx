"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"

const SALUTATIONS = ["", "Mr", "Mrs", "Ms", "Miss", "Dr", "Prof"]
const EMPTY_FORM = { salutation: "", name: "", email: "", phone: "", addressLine1: "", addressLine2: "", postcode: "", notes: "" }
const PAGE_SIZE = 50

export default function ContactsPage() {
  const router = useRouter()

  // List state
  const [contacts, setContacts]   = useState<any[]>([])
  const [total, setTotal]         = useState(0)
  const [offset, setOffset]       = useState(0)
  const [search, setSearch]       = useState("")
  const [listLoading, setListLoading] = useState(false)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm]             = useState({ ...EMPTY_FORM })
  const [creating, setCreating]     = useState(false)
  const [createMsg, setCreateMsg]   = useState("")

  // Detail overlay
  const [overlay, setOverlay]       = useState<any>(null)
  const [editForm, setEditForm]     = useState<any>(null)
  const [overlayTab, setOverlayTab] = useState<"details" | "seller" | "buyer">("details")
  const [receipts, setReceipts]     = useState<any[]>([])
  const [submissions, setSubmissions] = useState<any[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [saveMsg, setSaveMsg]       = useState("")

  const load = useCallback(async (q: string, off: number) => {
    setListLoading(true)
    try {
      const res  = await fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${off}`)
      const data = await res.json()
      setContacts(data.contacts ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => { load("", 0) }, [load])

  function runSearch() {
    setOffset(0)
    load(search, 0)
  }

  function clearSearch() {
    setSearch("")
    setOffset(0)
    load("", 0)
  }

  function goPage(newOffset: number) {
    setOffset(newOffset)
    load(search, newOffset)
  }

  // Open detail overlay
  async function openOverlay(c: any) {
    setOverlay(c)
    setEditForm({ salutation: c.salutation || "", name: c.name, email: c.email || "", phone: c.phone || "", addressLine1: c.addressLine1 || "", addressLine2: c.addressLine2 || "", postcode: c.postcode || "", notes: c.notes || "" })
    setOverlayTab("details")
    setSaveMsg("")
    setDetailLoading(true)
    try {
      const [rRes, sRes] = await Promise.all([
        fetch(`/api/warehouse/receipts?customer_id=${c.id}`),
        fetch(`/api/submissions?contact_id=${c.id}`),
      ])
      setReceipts(rRes.ok ? await rRes.json() : [])
      setSubmissions(sRes.ok ? await sRes.json() : [])
    } finally {
      setDetailLoading(false)
    }
  }

  function closeOverlay() {
    setOverlay(null)
    setEditForm(null)
    setReceipts([])
    setSubmissions([])
  }

  async function doSave() {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/contacts/${overlay.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm),
      })
      if (res.ok) {
        const updated = await res.json()
        setOverlay(updated)
        setSaveMsg("Saved")
        setTimeout(() => setSaveMsg(""), 2000)
        load(search, offset)
      }
    } finally {
      setDetailLoading(false) }
  }

  async function doCreate() {
    if (!form.name.trim()) { setCreateMsg("Name is required"); return }
    setCreating(true)
    try {
      const res  = await fetch("/api/contacts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setCreateMsg(data.error || "Error creating contact"); return }
      setShowCreate(false)
      setForm({ ...EMPTY_FORM })
      setCreateMsg("")
      load(search, offset)
      openOverlay(data)
    } finally { setCreating(false) }
  }

  const totalPages  = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="p-6 space-y-4" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total > 0 ? `${total.toLocaleString()} contacts` : "Unified contact database"}
          </p>
        </div>
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          onClick={() => setShowCreate(true)}
        >
          + New Customer
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search name, phone, email, postcode, address, ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") runSearch() }}
        />
        <button className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg" onClick={runSearch}>Search</button>
        <button className="border border-gray-300 text-sm px-4 py-2 rounded-lg text-gray-600" onClick={clearSearch}>Clear</button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">ID</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Postcode</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Address</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Seller</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Buyer</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listLoading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">No customers found</td></tr>
            ) : contacts.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openOverlay(c)}>
                <td className="px-4 py-3 font-mono text-xs text-gray-400">{c.id}</td>
                <td className="px-4 py-3 font-medium text-gray-900 text-sm">{c.salutation ? `${c.salutation} ` : ""}{c.name}</td>
                <td className="px-4 py-3 text-gray-500 text-sm">{c.phone || "—"}</td>
                <td className="px-4 py-3 text-gray-500 text-sm">{c.email || "—"}</td>
                <td className="px-4 py-3 text-gray-500 text-sm">{c.postcode || "—"}</td>
                <td className="px-4 py-3 text-gray-500 text-sm">{c.addressLine1 || "—"}</td>
                <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                  {c._count?.receipts > 0
                    ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-600 text-xs font-bold">✓</span>
                    : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                  {c._count?.submissions > 0
                    ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">✓</span>
                    : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm text-blue-600 font-medium">View →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
            <span>Page {currentPage} of {totalPages} &nbsp;·&nbsp; {total.toLocaleString()} total</span>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => goPage(offset - PAGE_SIZE)}
                className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >← Prev</button>
              <button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => goPage(offset + PAGE_SIZE)}
                className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4">
            <h2 className="font-semibold text-lg text-gray-900">New Customer</h2>
            {createMsg && <p className="text-sm text-red-600">{createMsg}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Salutation</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.salutation} onChange={e => setForm({ ...form, salutation: e.target.value })}>
                  {SALUTATIONS.map(s => <option key={s} value={s}>{s || "—"}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 1</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.addressLine1} onChange={e => setForm({ ...form, addressLine1: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 2</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.addressLine2} onChange={e => setForm({ ...form, addressLine2: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.postcode} onChange={e => setForm({ ...form, postcode: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="flex-1 border border-gray-300 text-sm py-2 rounded-lg text-gray-600" onClick={() => { setShowCreate(false); setCreateMsg("") }}>Cancel</button>
              <button className="flex-1 bg-blue-600 text-white text-sm py-2 rounded-lg font-medium" onClick={doCreate} disabled={creating}>{creating ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Overlay ── */}
      {overlay && editForm && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "rgba(0,0,0,0.6)" }} onClick={closeOverlay}>
          <div
            className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl flex flex-col"
            style={{ maxHeight: "90vh" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Overlay header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{overlay.id}</span>
                <h2 className="text-lg font-bold text-gray-900">
                  {overlay.salutation ? `${overlay.salutation} ` : ""}{overlay.name}
                </h2>
                {receipts.length > 0 && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Seller</span>
                )}
                {submissions.length > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Buyer</span>
                )}
              </div>
              <button onClick={closeOverlay} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 px-6 shrink-0">
              {(["details", "seller", "buyer"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setOverlayTab(t)}
                  className={`mr-6 py-3 text-sm font-semibold border-b-2 transition-colors capitalize ${
                    overlayTab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t === "seller" ? `Seller — Warehouse (${receipts.length})` : t === "buyer" ? `Buyer — CRM (${submissions.length})` : "Details"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-6">

              {overlayTab === "details" && (
                <div className="max-w-2xl space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Salutation</label>
                      <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={editForm.salutation} onChange={e => setEditForm({ ...editForm, salutation: e.target.value })}>
                        {SALUTATIONS.map(s => <option key={s} value={s}>{s || "—"}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 1</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={editForm.addressLine1} onChange={e => setEditForm({ ...editForm, addressLine1: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 2</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={editForm.addressLine2} onChange={e => setEditForm({ ...editForm, addressLine2: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={editForm.postcode} onChange={e => setEditForm({ ...editForm, postcode: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                      <textarea className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                    </div>
                  </div>
                  {saveMsg && <p className="text-sm text-green-600">{saveMsg}</p>}
                  <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg" onClick={doSave} disabled={detailLoading}>
                    {detailLoading ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              )}

              {overlayTab === "seller" && (
                <div>
                  {detailLoading ? (
                    <p className="text-sm text-gray-400">Loading…</p>
                  ) : receipts.length === 0 ? (
                    <p className="text-sm text-gray-400">No warehouse receipts found for this customer.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">
                        <th className="pb-2 text-left">Receipt ID</th>
                        <th className="pb-2 text-left">Status</th>
                        <th className="pb-2 text-left">Date</th>
                        <th className="pb-2 text-left">Containers</th>
                        <th className="pb-2"></th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {receipts.map((r: any) => (
                          <tr key={r.id} className="py-2">
                            <td className="py-2 font-mono font-bold text-gray-800">{r.id}</td>
                            <td className="py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === "open" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{r.status}</span></td>
                            <td className="py-2 text-gray-500">{new Date(r.created_at).toLocaleDateString("en-GB")}</td>
                            <td className="py-2 text-gray-500">{r.containers?.length ?? 0}</td>
                            <td className="py-2 text-right">
                              <button className="text-blue-600 hover:underline text-xs" onClick={() => router.push(`/tools/warehouse/receipts?id=${r.id}`)}>View →</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {overlayTab === "buyer" && (
                <div>
                  {detailLoading ? (
                    <p className="text-sm text-gray-400">Loading…</p>
                  ) : submissions.length === 0 ? (
                    <p className="text-sm text-gray-400">No CRM submissions found for this customer.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">
                        <th className="pb-2 text-left">Reference</th>
                        <th className="pb-2 text-left">Status</th>
                        <th className="pb-2 text-left">Channel</th>
                        <th className="pb-2 text-left">Date</th>
                        <th className="pb-2"></th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {submissions.map((s: any) => (
                          <tr key={s.id}>
                            <td className="py-2 font-mono text-xs text-gray-500">{s.reference?.slice(0, 8).toUpperCase()}</td>
                            <td className="py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{s.status?.replace(/_/g, " ")}</span></td>
                            <td className="py-2 text-gray-500">{s.channel}</td>
                            <td className="py-2 text-gray-500">{new Date(s.createdAt).toLocaleDateString("en-GB")}</td>
                            <td className="py-2 text-right">
                              <button className="text-blue-600 hover:underline text-xs" onClick={() => router.push(`/submissions/${s.id}`)}>View →</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
