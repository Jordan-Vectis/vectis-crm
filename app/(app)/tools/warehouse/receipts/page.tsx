"use client"

import { useEffect, useState } from "react"

function PrintLabel({ container, receipt, customer }: { container: any; receipt: any; customer: any }) {
  return (
    <div>
      <button onClick={() => window.print()} className="wh-btn-secondary wh-btn-sm">🖨 Print</button>
      <div id="print-label" className="hidden" style={{ padding: "1rem", border: "4px solid black", width: "20rem" }}>
        <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
          <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280" }}>Warehouse</p>
        </div>
        <div style={{ textAlign: "center", margin: "0.75rem 0" }}>
          <p style={{ fontSize: "2.5rem", fontWeight: "bold", fontFamily: "monospace" }}>{container?.id}</p>
          <p style={{ fontSize: "0.875rem", color: "#4b5563", textTransform: "capitalize" }}>{container?.type}</p>
        </div>
        <hr style={{ borderColor: "black", margin: "0.5rem 0" }} />
        <div style={{ fontSize: "0.875rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Receipt:</span><span style={{ fontFamily: "monospace" }}>{receipt?.id}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Customer:</span><span>{customer?.name}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Cust ID:</span><span style={{ fontFamily: "monospace" }}>{customer?.id}</span></div>
        </div>
        {container?.description && <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f3f4f6", fontSize: "0.875rem" }}><span style={{ fontWeight: 600 }}>Desc: </span>{container.description}</div>}
        <div style={{ textAlign: "center", marginTop: "0.75rem", fontSize: "0.75rem", color: "#9ca3af" }}>{new Date().toLocaleDateString()}</div>
      </div>
    </div>
  )
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [containers, setContainers] = useState<any[]>([])
  const [customer, setCustomer] = useState<any>(null)
  const [filterStatus, setFilterStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [editNotes, setEditNotes] = useState("")
  const [editRate, setEditRate] = useState("")
  const [msg, setMsg] = useState("")

  async function load() {
    const res = await fetch(`/api/warehouse/receipts?status=${filterStatus}`)
    setReceipts(await res.json())
  }

  useEffect(() => { load() }, [filterStatus])

  async function selectReceipt(r: any) {
    setSelected(r)
    setEditNotes(r.notes || "")
    setEditRate(String(r.commission_rate))
    const [contRes, custRes] = await Promise.all([
      fetch(`/api/warehouse/receipts/${r.id}/containers`),
      fetch(`/api/warehouse/customers/${r.customer_id}`),
    ])
    setContainers(await contRes.json())
    setCustomer(await custRes.json())
  }

  async function doSave() {
    setLoading(true)
    try {
      const res = await fetch(`/api/warehouse/receipts/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commission_rate: editRate, notes: editNotes }),
      })
      if (res.ok) {
        const data = await res.json()
        setSelected(data)
        setMsg("Saved")
        setTimeout(() => setMsg(""), 2000)
        load()
      }
    } finally { setLoading(false) }
  }

  async function toggleStatus() {
    const newStatus = selected.status === "open" ? "closed" : "open"
    setLoading(true)
    try {
      const res = await fetch(`/api/warehouse/receipts/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) { const data = await res.json(); setSelected(data); load() }
    } finally { setLoading(false) }
  }

  return (
    <div className="p-6 space-y-4" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
        <select className="wh-input" style={{ width: "9rem" }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <div className="flex gap-4">
        <div className="wh-card p-0 overflow-hidden flex-1">
          <table className="w-full">
            <thead><tr>
              <th className="wh-table-header">Receipt</th>
              <th className="wh-table-header">Customer</th>
              <th className="wh-table-header">Commission</th>
              <th className="wh-table-header">Status</th>
              <th className="wh-table-header">Date</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {receipts.map(r => (
                <tr key={r.id} onClick={() => selectReceipt(r)}
                  className="cursor-pointer hover:bg-gray-50"
                  style={selected?.id === r.id ? { background: "#eff6ff" } : {}}>
                  <td className="wh-table-cell font-mono font-bold">{r.id}</td>
                  <td className="wh-table-cell">
                    <span className="font-medium">{r.customer_name}</span>
                    <span className="text-xs text-gray-400 ml-1 font-mono">({r.customer_id})</span>
                  </td>
                  <td className="wh-table-cell">{r.commission_rate}%</td>
                  <td className="wh-table-cell">
                    <span className={`wh-badge ${r.status === "open" ? "wh-badge-green" : "wh-badge-gray"}`}>{r.status}</span>
                  </td>
                  <td className="wh-table-cell text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {receipts.length === 0 && (
                <tr><td colSpan={5} className="wh-table-cell text-center text-gray-400 py-8">No receipts</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ width: "20rem" }} className="space-y-4">
            <div className="wh-card space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-lg">{selected.id}</span>
                <span className={`wh-badge ${selected.status === "open" ? "wh-badge-green" : "wh-badge-gray"}`}>{selected.status}</span>
              </div>
              {customer && (
                <p className="text-sm text-gray-600">
                  <span className="font-mono text-xs">{customer.id}</span> — {customer.name}
                </p>
              )}
              <div>
                <label className="wh-label">Commission Rate (%)</label>
                <input className="wh-input" type="number" value={editRate} onChange={e => setEditRate(e.target.value)} />
              </div>
              <div>
                <label className="wh-label">Notes</label>
                <textarea className="wh-input" rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
              </div>
              {msg && <p className="text-sm text-green-600">{msg}</p>}
              <div className="flex gap-2">
                <button className="wh-btn-primary flex-1" onClick={doSave} disabled={loading}>Save</button>
                <button className="wh-btn-secondary" onClick={toggleStatus} disabled={loading}>
                  {selected.status === "open" ? "Close" : "Reopen"}
                </button>
              </div>
            </div>
            <div className="wh-card p-0 overflow-hidden">
              <p className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-50">Containers ({containers.length})</p>
              <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {containers.map((c: any) => (
                  <div key={c.id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-sm">{c.id}</span>
                      <span className="wh-badge wh-badge-blue capitalize">{c.type}</span>
                    </div>
                    <p className="text-xs text-gray-600">{c.description}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-400">
                        {c.current_location ? <span className="wh-badge wh-badge-green">{c.current_location}</span> : "Unlocated"}
                      </span>
                      <PrintLabel container={c} receipt={selected} customer={customer} />
                    </div>
                  </div>
                ))}
                {containers.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">No containers</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
