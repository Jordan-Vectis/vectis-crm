"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

const SALUTATIONS = ["", "Mr", "Mrs", "Ms", "Miss", "Dr", "Prof"]
const EMPTY_FORM = { salutation: "", name: "", email: "", phone: "", addressLine1: "", addressLine2: "", postcode: "", notes: "" }

export default function ContactsPage() {
  const router = useRouter()
  const [contacts, setContacts] = useState<any[]>([])
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<any>(null)
  const [tab, setTab] = useState<"details" | "seller" | "buyer">("details")
  const [editForm, setEditForm] = useState<any>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [receipts, setReceipts] = useState<any[]>([])
  const [submissions, setSubmissions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState("")

  async function load(q = "") {
    const res = await fetch(`/api/contacts?search=${encodeURIComponent(q)}`)
    setContacts(await res.json())
  }

  useEffect(() => { load() }, [])

  async function selectContact(c: any) {
    setSelected(c)
    setTab("details")
    setEditForm({ ...c, salutation: c.salutation || "", addressLine1: c.addressLine1 || "", addressLine2: c.addressLine2 || "", postcode: c.postcode || "", notes: c.notes || "" })
    const [rRes, sRes] = await Promise.all([
      fetch(`/api/warehouse/receipts?customer_id=${c.id}`),
      fetch(`/api/submissions?contact_id=${c.id}`),
    ])
    setReceipts(rRes.ok ? await rRes.json() : [])
    setSubmissions(sRes.ok ? await sRes.json() : [])
  }

  async function doCreate() {
    if (!form.name.trim()) { setMsg("Name required"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/contacts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setMsg(data.error || "Error"); return }
      setShowCreate(false)
      setForm({ ...EMPTY_FORM })
      setMsg("")
      load()
      selectContact(data)
    } finally { setLoading(false) }
  }

  async function doSave() {
    setLoading(true)
    try {
      const res = await fetch(`/api/contacts/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm),
      })
      if (res.ok) {
        const data = await res.json()
        setSelected(data)
        setMsg("Saved")
        setTimeout(() => setMsg(""), 2000)
        load(search)
      }
    } finally { setLoading(false) }
  }

  return (
    <div className="p-6 space-y-4" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
        <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg" onClick={() => setShowCreate(true)}>+ New Contact</button>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <div className="flex gap-2">
        <input className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search name, phone, email, postcode, address…" value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") load(search) }} />
        <button className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg" onClick={() => load(search)}>Search</button>
        <button className="border border-gray-300 text-sm px-4 py-2 rounded-lg" onClick={() => { setSearch(""); load("") }}>Clear</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4">
            <h2 className="font-semibold text-lg">New Contact</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Salutation</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.salutation} onChange={e => setForm({...form, salutation: e.target.value})}>
                  {SALUTATIONS.map(s => <option key={s} value={s}>{s || "—"}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 1</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.addressLine1} onChange={e => setForm({...form, addressLine1: e.target.value})} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 2</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.addressLine2} onChange={e => setForm({...form, addressLine2: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.postcode} onChange={e => setForm({...form, postcode: e.target.value})} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 border border-gray-300 text-sm py-2 rounded-lg" onClick={() => { setShowCreate(false); setMsg("") }}>Cancel</button>
              <button className="flex-1 bg-blue-600 text-white text-sm py-2 rounded-lg" onClick={doCreate} disabled={loading}>Create</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {/* Contact list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1">
          <table className="w-full">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">ID</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Phone</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Postcode</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Address</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.map(c => (
                <tr key={c.id} onClick={() => selectContact(c)}
                  className="cursor-pointer hover:bg-gray-50"
                  style={selected?.id === c.id ? { background: "#eff6ff" } : {}}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.salutation ? `${c.salutation} ` : ""}{c.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{c.phone}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{c.email}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{c.postcode}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{c.addressLine1}</td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No contacts found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selected && editForm && (
          <div style={{ width: "24rem" }} className="space-y-3 shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{selected.salutation ? `${selected.salutation} ` : ""}{selected.name}</p>
                  <span className="font-mono text-xs text-blue-600">{selected.id}</span>
                </div>
              </div>
              {/* Tabs */}
              <div className="flex border-b border-gray-100">
                {(["details", "seller", "buyer"] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`flex-1 py-2 text-xs font-semibold capitalize transition-colors ${tab === t ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}>
                    {t === "seller" ? "Seller (Warehouse)" : t === "buyer" ? "Buyer (Auctions)" : "Details"}
                  </button>
                ))}
              </div>

              {tab === "details" && (
                <div className="p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Salutation</label>
                      <select className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={editForm.salutation} onChange={e => setEditForm({...editForm, salutation: e.target.value})}>
                        {SALUTATIONS.map(s => <option key={s} value={s}>{s || "—"}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                      <input className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                      <input className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={editForm.phone || ""} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                      <input className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={editForm.email || ""} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 1</label>
                      <input className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={editForm.addressLine1 || ""} onChange={e => setEditForm({...editForm, addressLine1: e.target.value})} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 2</label>
                      <input className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={editForm.addressLine2 || ""} onChange={e => setEditForm({...editForm, addressLine2: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
                      <input className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={editForm.postcode || ""} onChange={e => setEditForm({...editForm, postcode: e.target.value})} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                      <textarea className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" rows={2} value={editForm.notes || ""} onChange={e => setEditForm({...editForm, notes: e.target.value})} />
                    </div>
                  </div>
                  {msg && <p className="text-xs text-green-600">{msg}</p>}
                  <button className="w-full bg-blue-600 text-white text-sm py-2 rounded-lg" onClick={doSave} disabled={loading}>Save Changes</button>
                </div>
              )}

              {tab === "seller" && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700">Warehouse Receipts</p>
                    <span className="text-xs text-gray-400">{receipts.length} total</span>
                  </div>
                  {receipts.length === 0 ? (
                    <p className="text-sm text-gray-400">No receipts found.</p>
                  ) : (
                    <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto rounded-lg border border-gray-100">
                      {receipts.map((r: any) => (
                        <div key={r.id} className="px-3 py-2 flex items-center justify-between">
                          <div>
                            <span className="font-mono text-sm font-bold">{r.id}</span>
                            <span className="text-xs text-gray-400 ml-2">{new Date(r.created_at).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.status === "open" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                            <button className="text-xs text-blue-600 hover:underline" onClick={() => router.push(`/tools/warehouse/receipts?id=${r.id}`)}>View</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === "buyer" && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700">Submissions / CRM</p>
                    <span className="text-xs text-gray-400">{submissions.length} total</span>
                  </div>
                  {submissions.length === 0 ? (
                    <p className="text-sm text-gray-400">No submissions found.</p>
                  ) : (
                    <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto rounded-lg border border-gray-100">
                      {submissions.map((s: any) => (
                        <div key={s.id} className="px-3 py-2 flex items-center justify-between">
                          <div>
                            <span className="font-mono text-xs text-gray-500">{s.reference?.slice(0, 8)}</span>
                            <span className="text-xs text-gray-400 ml-2">{new Date(s.createdAt).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{s.status?.replace(/_/g, " ")}</span>
                            <button className="text-xs text-blue-600 hover:underline" onClick={() => router.push(`/submissions/${s.id}`)}>View</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
