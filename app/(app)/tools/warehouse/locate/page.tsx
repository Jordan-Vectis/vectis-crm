"use client"

import { useRef, useState } from "react"

function BarcodeInput({ value, onChange, onScan, placeholder = "Scan or type…", autoFocus = false, className = "" }: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onScan: (val: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const lastKeyTime = useRef(0)
  const buffer = useRef("")

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now = Date.now()
    const delta = now - lastKeyTime.current
    lastKeyTime.current = now
    if (e.key === "Enter") {
      if (value.trim()) { onScan(value.trim()); buffer.current = "" }
      e.preventDefault()
      return
    }
    if (delta < 30 && e.key.length === 1) buffer.current += e.key
    else buffer.current = e.key.length === 1 ? e.key : ""
  }

  return (
    <input type="text" value={value} onChange={onChange} placeholder={placeholder}
      autoFocus={autoFocus} onKeyDown={handleKeyDown}
      className={`wh-input font-mono ${className}`} />
  )
}

export default function LocatePage() {
  const [containerId, setContainerId] = useState("")
  const [container, setContainer] = useState<any>(null)
  const [locationCode, setLocationCode] = useState("")
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<any>(null)
  const [error, setError] = useState("")

  async function lookupContainer(id: string) {
    const val = (id || containerId).trim()
    if (!val) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/warehouse/containers/${val}`)
      if (!res.ok) { setError(`Container ${val} not found`); setContainer(null); return }
      setContainer(await res.json())
      setContainerId(val)
    } finally { setLoading(false) }
  }

  async function doLocate() {
    const loc = locationCode.trim().toUpperCase()
    if (!loc) { setError("Enter a location code"); return }
    if (!container) { setError("Scan a container first"); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/warehouse/locations/${loc}/place/${container.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }),
      })
      if (!res.ok) { setError("Error placing container"); return }
      setLastResult({ container: container.id, location: loc })
      setContainer(null); setContainerId(""); setLocationCode(""); setNotes(""); setError("")
    } finally { setLoading(false) }
  }

  return (
    <div className="p-6 max-w-lg space-y-6" style={{ fontFamily: "Arial, sans-serif" }}>
      <h1 className="text-2xl font-bold text-gray-900">Locate Container</h1>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="wh-card space-y-4">
        <div>
          <label className="wh-label">Container ID (scan or type)</label>
          <div className="flex gap-2">
            <BarcodeInput value={containerId} onChange={e => setContainerId(e.target.value)}
              onScan={lookupContainer} placeholder="t000001 or p00001…" autoFocus className="flex-1" />
            <button className="wh-btn-primary" onClick={() => lookupContainer(containerId)} disabled={loading}>Look up</button>
          </div>
        </div>

        {container && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "0.5rem", padding: "1rem" }} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold" style={{ color: "#1e3a8a" }}>{container.id}</span>
              <span className="wh-badge wh-badge-blue capitalize">{container.type}</span>
            </div>
            <p className="text-sm" style={{ color: "#1e40af" }}>{container.description}</p>
            <p className="text-xs" style={{ color: "#2563eb" }}>Receipt: {container.receipt_id}</p>
            {container.current_location
              ? <p className="text-xs" style={{ color: "#2563eb" }}>Currently at: <strong>{container.current_location}</strong></p>
              : <p className="text-xs" style={{ color: "#ca8a04" }}>Currently unlocated</p>
            }
          </div>
        )}

        <div>
          <label className="wh-label">Location Code (scan or type)</label>
          <BarcodeInput value={locationCode}
            onChange={e => setLocationCode(e.target.value.toUpperCase())}
            onScan={code => setLocationCode(code.toUpperCase())}
            placeholder="e.g. A1A1, B32C4…" className="uppercase" />
        </div>

        <div>
          <label className="wh-label">Notes (optional)</label>
          <input className="wh-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes…" />
        </div>

        <button className="wh-btn-primary w-full justify-center" onClick={doLocate} disabled={loading || !container}>
          {loading ? "Locating…" : "Confirm Location"}
        </button>
      </div>

      {lastResult && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "0.5rem", padding: "1rem" }}>
          <p style={{ color: "#166534", fontWeight: 500 }}>
            ✓ <span className="font-mono">{lastResult.container}</span> placed at <span className="font-mono font-bold">{lastResult.location}</span>
          </p>
        </div>
      )}
    </div>
  )
}
