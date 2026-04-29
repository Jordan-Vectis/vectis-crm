"use client"

import { useState, useRef, useEffect } from "react"
import { showError } from "@/lib/error-modal"

type MacroMeta = {
  id:          string
  name:        string
  filename:    string
  description: string | null
  mimeType:    string
  size:        number
  createdAt:   string
}

function formatBytes(n: number) {
  if (n < 1024)       return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function MacroTab() {
  const [files,       setFiles]       = useState<MacroMeta[]>([])
  const [loading,     setLoading]     = useState(true)
  const [uploading,   setUploading]   = useState(false)
  const [showUpload,  setShowUpload]  = useState(false)
  const [name,        setName]        = useState("")
  const [description, setDescription] = useState("")
  const [pickedFile,  setPickedFile]  = useState<File | null>(null)
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/macros")
      setFiles(await r.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function upload() {
    if (!pickedFile || !name.trim() || uploading) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file",        pickedFile)
      fd.append("name",        name.trim())
      fd.append("description", description.trim())
      const res = await fetch("/api/macros", { method: "POST", body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const created: MacroMeta = await res.json()
      setFiles(prev => [created, ...prev])
      setShowUpload(false)
      setName("")
      setDescription("")
      setPickedFile(null)
    } catch (e: any) {
      showError("Upload failed", e.message)
    } finally {
      setUploading(false)
    }
  }

  async function deleteFile(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return
    setDeleting(id)
    try {
      await fetch(`/api/macros/${id}`, { method: "DELETE" })
      setFiles(prev => prev.filter(f => f.id !== id))
    } catch (e: any) {
      showError("Delete failed", e.message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">

      {/* ── How the macro works ── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">How the BC Macro Works</h2>

        <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-5 space-y-4 text-sm text-gray-300 leading-relaxed">
          <p>
            The <span className="text-white font-medium">BC Macro</span> is an AutoHotkey v2 script that automates
            the process of entering lots into the Bidpath Cataloguing (BC) system. Instead of typing each lot manually,
            it reads a CSV exported from this app and clicks through the BC interface automatically.
          </p>

          <div className="space-y-3">
            <h3 className="text-white font-medium">Setup (one time only)</h3>
            <ol className="list-decimal list-inside space-y-1.5 text-gray-400">
              <li>Install <span className="text-gray-200">AutoHotkey v2</span> from <span className="text-[#2AB4A6]">autohotkey.com</span></li>
              <li>Download the macro file below and save it to a folder on your computer</li>
              <li>The macro expects a file called <code className="bg-[#2C2C2E] px-1.5 py-0.5 rounded text-xs text-gray-200">bc_import.csv</code> in the <span className="italic">same folder</span> as the script</li>
            </ol>
          </div>

          <div className="space-y-3">
            <h3 className="text-white font-medium">Running the macro (Tote version)</h3>
            <ol className="list-decimal list-inside space-y-1.5 text-gray-400">
              <li>In the Auction Manager, use <span className="text-gray-200">Export for BC Macro (Tote)</span> to download the CSV</li>
              <li>Place the CSV in the same folder as the script, named <code className="bg-[#2C2C2E] px-1.5 py-0.5 rounded text-xs text-gray-200">bc_import.csv</code></li>
              <li>Open the Bidpath Cataloguing page in Chrome and make sure it is visible on screen</li>
              <li>Double-click the <code className="bg-[#2C2C2E] px-1.5 py-0.5 rounded text-xs text-gray-200">.ahk</code> file to start AutoHotkey</li>
              <li>Press <kbd className="bg-[#2C2C2E] border border-gray-600 px-2 py-0.5 rounded text-xs text-gray-200 font-mono">F9</kbd> to begin — confirm the popup and let it run</li>
              <li>Press <kbd className="bg-[#2C2C2E] border border-gray-600 px-2 py-0.5 rounded text-xs text-gray-200 font-mono">Escape</kbd> at any time to stop the script</li>
            </ol>
          </div>

          <div className="bg-yellow-950/40 border border-yellow-800/50 rounded-lg px-4 py-3 text-yellow-300 text-xs">
            ⚠ The macro uses fixed screen coordinates. If your screen resolution or Chrome window position is different
            from the machine it was created on, you may need to adjust the <code className="bg-black/20 px-1 rounded">MouseMove</code> values inside the script.
          </div>

          <div className="space-y-1.5">
            <h3 className="text-white font-medium">CSV format</h3>
            <p className="text-gray-400 text-xs">The exported CSV has three columns:</p>
            <div className="bg-[#2C2C2E] rounded-lg px-4 py-3 font-mono text-xs text-gray-300 space-y-1">
              <div><span className="text-gray-500">tote</span>, <span className="text-gray-500">count</span>, <span className="text-gray-500">barcodes (pipe-separated)</span></div>
              <div className="text-gray-400">T001, 3, F051001|F051002|F051003</div>
              <div className="text-gray-400">T002, 2, F051004|F051005</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Macro files ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Macro Files</h2>
          <button
            onClick={() => setShowUpload(v => !v)}
            className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] text-black font-semibold px-4 py-1.5 rounded-lg transition-colors"
          >
            {showUpload ? "Cancel" : "+ Upload macro"}
          </button>
        </div>

        {/* Upload form */}
        {showUpload && (
          <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-medium text-white">Upload new macro file</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Display name <span className="text-red-400">*</span></label>
                <input
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Make BC Lots (Tote)"
                  className="w-full bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#2AB4A6]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">File <span className="text-red-400">*</span></label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-xs border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white px-3 py-2 rounded-lg transition-colors"
                  >
                    {pickedFile ? pickedFile.name : "Choose file…"}
                  </button>
                  {pickedFile && (
                    <span className="text-xs text-gray-500">{formatBytes(pickedFile.size)}</span>
                  )}
                </div>
                <input ref={fileRef} type="file" className="hidden"
                  onChange={e => setPickedFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Description (optional)</label>
              <textarea
                value={description} onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief description of what this macro does…"
                className="w-full bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#2AB4A6] resize-none"
              />
            </div>
            <button
              onClick={upload}
              disabled={uploading || !name.trim() || !pickedFile}
              className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        )}

        {/* File list */}
        {loading ? (
          <div className="text-sm text-gray-500 py-4">Loading…</div>
        ) : files.length === 0 ? (
          <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-8 text-center text-gray-600">
            <p className="text-3xl mb-3">📂</p>
            <p className="text-sm">No macro files uploaded yet. Click <span className="text-[#2AB4A6]">+ Upload macro</span> to add one.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map(f => (
              <div key={f.id} className="bg-[#1C1C1E] border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4">
                <div className="text-2xl flex-shrink-0">⌨️</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{f.name}</p>
                  <p className="text-xs text-gray-500">{f.filename} · {formatBytes(f.size)} · {new Date(f.createdAt).toLocaleDateString("en-GB")}</p>
                  {f.description && (
                    <p className="text-xs text-gray-400 mt-1">{f.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a
                    href={`/api/macros/${f.id}`}
                    download={f.filename}
                    className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] text-black font-semibold px-4 py-1.5 rounded-lg transition-colors"
                  >
                    ↓ Download
                  </a>
                  <button
                    onClick={() => deleteFile(f.id, f.name)}
                    disabled={deleting === f.id}
                    className="text-xs text-gray-600 hover:text-red-400 border border-gray-700 hover:border-red-800 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {deleting === f.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
