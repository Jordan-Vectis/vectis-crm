"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ─── IT Tools → Screenshots ───────────────────────────────────────────────────
//
// A snipping-tool stand-in that keeps the result in the Hub. Jordan (2026-09-07):
// "a snipping tool alternative as well that saves screenshots into the hub and
// lets me annotate and draw symbols on etc".
//
// Get an image in three ways: 📸 Capture (the same screen/window/tab picker as
// the recorder — one frame is grabbed and the share stopped at once), Ctrl+V a
// screenshot from the clipboard, or upload a file. Then ✂ crop, and mark it up
// with pen, highlighter, box, circle, arrow, text, numbered markers and ✓ ✗ ⚠
// stamps. Save to the Hub, copy the image for pasting into an email, or download.
//
// ⚠ Things that are the way they are on purpose:
//   - Everything is drawn on ONE canvas from an immutable list of shapes over the
//     base image, so Undo is just "drop the last shape" and cropping only has to
//     translate the shapes it keeps.
//   - Pointer events, not mouse events, with touch-action: none — the iPads can't
//     capture a screen but they can paste, upload and draw with a finger or pencil.
//   - The PNG goes straight to R2 on a presigned PUT and is registered afterwards;
//     the saved files are read back THROUGH the Hub (same origin), so thumbnails,
//     the viewer, Copy image and Download need no CORS rule on the bucket.
//   - Capture has the same in-flight guard as the recorder: a double-click must
//     not open two pickers.

type Shot = { id: string; title: string; sizeBytes: number; width: number; height: number; takenByName: string; createdAt: string }
type Pt = { x: number; y: number }
type Shape =
  | { t: "pen" | "hl"; pts: Pt[]; color: string; width: number }
  | { t: "rect" | "ellipse"; x: number; y: number; w: number; h: number; color: string; width: number }
  | { t: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { t: "text"; x: number; y: number; text: string; color: string; size: number }
  | { t: "stamp"; x: number; y: number; glyph: string; color: string; size: number }
type Tool = "crop" | "pen" | "hl" | "rect" | "ellipse" | "arrow" | "text" | "number" | "tick" | "cross" | "warn"
type Sel = { x: number; y: number; w: number; h: number }
type Phase = "idle" | "editing" | "saving" | "saved" | "error"

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "crop",    label: "✂ Crop",      hint: "Drag a box round the part you want — it crops the moment you let go. Undo puts it back." },
  { id: "pen",     label: "✏ Pen",       hint: "Draw freehand" },
  { id: "hl",      label: "🖍 Highlight", hint: "See-through marker" },
  { id: "rect",    label: "▭ Box",       hint: "Drag a rectangle" },
  { id: "ellipse", label: "◯ Circle",    hint: "Drag an oval" },
  { id: "arrow",   label: "➜ Arrow",     hint: "Drag from the tail to the point" },
  { id: "text",    label: "T Text",      hint: "Click where the text goes, type, press Enter" },
  { id: "number",  label: "① Number",    hint: "Click to place the next number — 1, 2, 3…" },
  { id: "tick",    label: "✓ Tick",      hint: "Click to stamp a tick" },
  { id: "cross",   label: "✗ Cross",     hint: "Click to stamp a cross" },
  { id: "warn",    label: "⚠ Warning",   hint: "Click to stamp a warning" },
]
const COLOURS: [string, string][] = [["Red", "#ef4444"], ["Yellow", "#facc15"], ["Green", "#22c55e"], ["Blue", "#3b82f6"], ["Black", "#111827"], ["White", "#ffffff"]]
const WIDTHS: [string, number][] = [["Thin", 3], ["Medium", 6], ["Thick", 12]]
const MAX_SIZE = 25 * 1024 * 1024

const fmtSize = (b: number) => b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

// ── Drawing ───────────────────────────────────────────────────────────────────
function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save()
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineCap = "round"; ctx.lineJoin = "round"
  switch (s.t) {
    case "pen":
    case "hl": {
      if (s.pts.length < 2) break
      if (s.t === "hl") { ctx.globalAlpha = 0.35; ctx.lineWidth = s.width * 3 } else ctx.lineWidth = s.width
      ctx.beginPath(); ctx.moveTo(s.pts[0].x, s.pts[0].y)
      for (const p of s.pts.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke(); break
    }
    case "rect":
      ctx.lineWidth = s.width; ctx.strokeRect(s.x, s.y, s.w, s.h); break
    case "ellipse":
      ctx.lineWidth = s.width; ctx.beginPath()
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2)
      ctx.stroke(); break
    case "arrow": {
      ctx.lineWidth = s.width
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), head = 12 + s.width * 2.5
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(s.x2, s.y2)
      ctx.lineTo(s.x2 - head * Math.cos(ang - Math.PI / 6), s.y2 - head * Math.sin(ang - Math.PI / 6))
      ctx.lineTo(s.x2 - head * Math.cos(ang + Math.PI / 6), s.y2 - head * Math.sin(ang + Math.PI / 6))
      ctx.closePath(); ctx.fill(); break
    }
    case "text":
      ctx.font = `bold ${s.size}px system-ui, sans-serif`; ctx.textBaseline = "top"
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4
      ctx.fillText(s.text, s.x, s.y); break
    case "stamp": {
      if (/^\d+$/.test(s.glyph)) {
        const r = s.size * 0.7
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = s.color === "#ffffff" ? "#111827" : "#ffffff"
        ctx.font = `bold ${s.size}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"
        ctx.fillText(s.glyph, s.x, s.y + s.size * 0.05)
      } else {
        ctx.font = `bold ${s.size * 1.6}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"
        ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4
        ctx.fillText(s.glyph, s.x, s.y)
      }
      break
    }
  }
  ctx.restore()
}

function normSel(s: Sel): Sel {
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) }
}

function shiftShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.t) {
    case "pen": case "hl": return { ...s, pts: s.pts.map(p => ({ x: p.x - dx, y: p.y - dy })) }
    case "rect": case "ellipse": return { ...s, x: s.x - dx, y: s.y - dy }
    case "arrow": return { ...s, x1: s.x1 - dx, y1: s.y1 - dy, x2: s.x2 - dx, y2: s.y2 - dy }
    case "text": case "stamp": return { ...s, x: s.x - dx, y: s.y - dy }
  }
}

function putWithProgress(url: string, blob: Blob, contentType: string) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", contentType)
    xhr.onload = () => (xhr.status === 200 || xhr.status === 204) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error("Upload failed — check the connection and try again"))
    xhr.send(blob)
  })
}

export default function ScreenshotTab({ active = true }: { active?: boolean }) {
  const [canCapture, setCanCapture] = useState<boolean | null>(null)
  const [phase, setPhase]     = useState<Phase>("idle")
  const [starting, setStarting] = useState(false)
  const [tool, setTool]       = useState<Tool>("pen")
  const [color, setColor]     = useState(COLOURS[0][1])
  const [width, setWidth]     = useState(WIDTHS[1][1])
  const [shapes, setShapes]   = useState<Shape[]>([])
  const [cropSel, setCropSel] = useState<Sel | null>(null)
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; value: string } | null>(null)
  const [cssScale, setCssScale] = useState(1)   // canvas px per CSS px, for the text overlay
  const [title, setTitle]     = useState("")
  const [error, setError]     = useState<string | null>(null)
  const [notice, setNotice]   = useState<string | null>(null)
  const [discardArmed, setDiscardArmed] = useState(false)
  const [hasImage, setHasImage] = useState(false)
  const [list, setList]       = useState<Shot[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [viewing, setViewing] = useState<Shot | null>(null)

  const canvasRef   = useRef<HTMLCanvasElement | null>(null)
  const baseRef     = useRef<ImageBitmap | null>(null)
  const shapesRef   = useRef<Shape[]>([])
  const drawingRef  = useRef<Shape | null>(null)
  const cropRef     = useRef<Sel | null>(null)
  const cropStartRef = useRef<Pt | null>(null)
  // ⚠ ONE undo list, in the order things happened. A crop is an entry alongside the
  // shapes (Jordan: "undo doesnt work for cropping"), so ↶ Undo steps back through
  // drawings and crops alike; a crop entry keeps the picture it replaced.
  const opsRef = useRef<({ k: "shape" } | { k: "crop"; bmp: ImageBitmap; dx: number; dy: number })[]>([])
  const [opCount, setOpCount] = useState(0)
  const nextNumberRef = useRef(1)
  const startingRef = useRef(false)
  const uploadedKeyRef = useRef<string | null>(null)
  const fileRef     = useRef<HTMLInputElement | null>(null)
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const titleRef    = useRef("")
  titleRef.current = title

  useEffect(() => { setCanCapture(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia) }, [])

  const load = useCallback(async () => {
    setListError(null); setActionError(null)
    try {
      const r = await fetch("/api/it-tools/screenshots")
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error ?? `Couldn't load the screenshots (${r.status})`)
      setList(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setList(null)
      const msg = e?.message ?? "Couldn't load the screenshots"
      setListError(/does not exist|relation|ScreenCapture/i.test(msg) ? `${msg} — has Run Migrations been done on this environment?` : msg)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // An image in the editor that hasn't been saved.
  useEffect(() => {
    if (!hasImage) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [hasImage])

  // Ctrl+V a screenshot — only while this tab is the one showing.
  useEffect(() => {
    if (!active) return
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith("image/"))
      if (!item) return
      const file = item.getAsFile()
      if (file) { e.preventDefault(); loadFile(file) }
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => { if (viewing) setActionError(null) }, [viewing])
  useEffect(() => {
    if (!viewing) return
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setViewing(null) }
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k)
  }, [viewing])

  // ── Render ─────────────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const c = canvasRef.current, base = baseRef.current
    if (!c || !base) return
    // Size the canvas from the picture HERE, not where the picture is loaded: at
    // that moment the canvas may not be mounted yet (it renders once hasImage is
    // true), and a canvas that is never sized is 300×150 — which painted only the
    // top-left corner of a full-screen capture. Setting width also clears it.
    if (c.width !== base.width || c.height !== base.height) { c.width = base.width; c.height = base.height; measure() }
    const ctx = c.getContext("2d")!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(base, 0, 0)
    for (const s of shapesRef.current) drawShape(ctx, s)
    if (drawingRef.current) drawShape(ctx, drawingRef.current)
    const sel = cropRef.current
    if (sel) {
      const n = normSel(sel)
      ctx.save()
      ctx.fillStyle = "rgba(0,0,0,0.45)"
      ctx.beginPath(); ctx.rect(0, 0, c.width, c.height); ctx.rect(n.x, n.y, n.w, n.h); ctx.fill("evenodd")
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.strokeRect(n.x, n.y, n.w, n.h)
      ctx.restore()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { redraw() }, [shapes, cropSel, redraw])
  // First paint once the canvas has actually mounted.
  useEffect(() => { if (hasImage) { measure(); redraw() } }, [hasImage, redraw])

  function setBitmap(bmp: ImageBitmap) {
    baseRef.current = bmp
    shapesRef.current = []; setShapes([])
    opsRef.current = []; setOpCount(0)
    setTool("crop")
    cropRef.current = null; setCropSel(null)
    drawingRef.current = null; setTextEdit(null)
    nextNumberRef.current = 1
    uploadedKeyRef.current = null
    setHasImage(true); setPhase("editing"); setError(null); setNotice(null); setDiscardArmed(false)
    requestAnimationFrame(() => { measure(); redraw() })
  }

  async function loadFile(file: File | Blob) {
    try {
      if (file.size > MAX_SIZE) throw new Error("That image is too large (max 25 MB)")
      setBitmap(await createImageBitmap(file))
    } catch (e: any) { setError(e?.message ?? "Couldn't read that image") }
  }

  function measure() {
    const c = canvasRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    if (r.width) setCssScale(c.width / r.width)
  }
  useEffect(() => { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure) }, [])

  // ── Capture ────────────────────────────────────────────────────────────────
  async function capture() {
    if (startingRef.current) return
    startingRef.current = true; setStarting(true); setNotice(null)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const video = document.createElement("video")
      video.srcObject = stream; video.muted = true; video.playsInline = true
      await video.play()
      // Let a real frame land before reading it — the very first paint can be black.
      await new Promise<void>(res => {
        const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => res()); else setTimeout(res, 200)
      })
      const c = document.createElement("canvas"); c.width = video.videoWidth; c.height = video.videoHeight
      if (!c.width || !c.height) throw new Error("Nothing came back from the screen — try again")
      c.getContext("2d")!.drawImage(video, 0, 0)
      setBitmap(await createImageBitmap(c))
    } catch (e: any) {
      if (e?.name === "NotAllowedError" || e?.name === "AbortError") {
        setNotice("Nothing was captured — the picker was closed, or screen capture is blocked on this computer.")
      } else if (e?.name === "InvalidStateError") {
        setNotice("Press Capture again — the browser needs the picker opened straight after the click.")
      } else setError(e?.message ?? "Couldn't capture the screen")
    } finally {
      stream?.getTracks().forEach(t => t.stop())
      startingRef.current = false; setStarting(false)
    }
  }

  // ── Pointer handling on the canvas ─────────────────────────────────────────
  function pos(e: React.PointerEvent<HTMLCanvasElement>): Pt {
    const c = e.currentTarget, r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  function commit(s: Shape) {
    shapesRef.current = [...shapesRef.current, s]; setShapes(shapesRef.current)
    opsRef.current.push({ k: "shape" }); setOpCount(opsRef.current.length)
  }
  const stampSize = () => 14 + width * 3
  const textSize  = () => 16 + width * 3

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!baseRef.current || textEdit) return
    e.currentTarget.setPointerCapture(e.pointerId)
    measure()
    const p = pos(e)
    switch (tool) {
      case "text":   setTextEdit({ x: p.x, y: p.y, value: "" }); setTimeout(() => textInputRef.current?.focus(), 0); return
      case "number": commit({ t: "stamp", x: p.x, y: p.y, glyph: String(nextNumberRef.current++), color, size: stampSize() }); return
      case "tick":   commit({ t: "stamp", x: p.x, y: p.y, glyph: "✓", color, size: stampSize() }); return
      case "cross":  commit({ t: "stamp", x: p.x, y: p.y, glyph: "✗", color, size: stampSize() }); return
      case "warn":   commit({ t: "stamp", x: p.x, y: p.y, glyph: "⚠", color, size: stampSize() }); return
      case "pen": case "hl": drawingRef.current = { t: tool, pts: [p], color, width }; break
      case "rect": case "ellipse": drawingRef.current = { t: tool, x: p.x, y: p.y, w: 0, h: 0, color, width }; break
      case "arrow": drawingRef.current = { t: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width }; break
      case "crop": cropStartRef.current = p; cropRef.current = { x: p.x, y: p.y, w: 0, h: 0 }; setCropSel(cropRef.current); break
    }
    redraw()
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = pos(e)
    const d = drawingRef.current
    if (d) {
      if (d.t === "pen" || d.t === "hl") d.pts.push(p)
      else if (d.t === "rect" || d.t === "ellipse") { d.w = p.x - d.x; d.h = p.y - d.y }
      else if (d.t === "arrow") { d.x2 = p.x; d.y2 = p.y }
      redraw(); return
    }
    if (tool === "crop" && cropStartRef.current) {
      const s = cropStartRef.current
      cropRef.current = { x: s.x, y: s.y, w: p.x - s.x, h: p.y - s.y }
      redraw()
    }
  }
  function onUp() {
    const d = drawingRef.current
    if (d) {
      drawingRef.current = null
      const keep =
        (d.t === "pen" || d.t === "hl") ? d.pts.length > 1 :
        (d.t === "rect" || d.t === "ellipse") ? Math.abs(d.w) > 2 && Math.abs(d.h) > 2 :
        d.t === "arrow" ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 4 : true
      if (keep) commit(d); else redraw()
      return
    }
    if (tool === "crop" && cropStartRef.current) {
      cropStartRef.current = null
      const n = cropRef.current ? normSel(cropRef.current) : null
      cropRef.current = n && n.w > 10 && n.h > 10 ? n : null
      setCropSel(cropRef.current)
      if (cropRef.current) applyCrop()   // snipping-tool feel: let go and it's cropped
    }
  }

  function commitText() {
    if (textEdit && textEdit.value.trim()) commit({ t: "text", x: textEdit.x, y: textEdit.y, text: textEdit.value.trim(), color, size: textSize() })
    setTextEdit(null)
  }

  function undo() {
    const op = opsRef.current.pop()
    if (!op) return
    setOpCount(opsRef.current.length)
    if (op.k === "crop") {
      // Put the picture back and move the mark-up with it.
      baseRef.current = op.bmp
      shapesRef.current = shapesRef.current.map(s => shiftShape(s, -op.dx, -op.dy)); setShapes(shapesRef.current)
      cropRef.current = null; setCropSel(null)
      setTool("crop")
      requestAnimationFrame(() => redraw())
      return
    }
    const last = shapesRef.current[shapesRef.current.length - 1]
    if (!last) return
    if (last.t === "stamp" && /^\d+$/.test(last.glyph)) nextNumberRef.current = Math.max(1, nextNumberRef.current - 1)
    shapesRef.current = shapesRef.current.slice(0, -1); setShapes(shapesRef.current)
  }

  async function applyCrop() {
    const base = baseRef.current, sel = cropRef.current
    if (!base || !sel) return
    const n = normSel(sel)
    const c = document.createElement("canvas"); c.width = Math.round(n.w); c.height = Math.round(n.h)
    c.getContext("2d")!.drawImage(base, n.x, n.y, n.w, n.h, 0, 0, n.w, n.h)
    const bmp = await createImageBitmap(c)
    const kept = shapesRef.current.map(s => shiftShape(s, n.x, n.y))   // mark-up moves with the picture
    opsRef.current.push({ k: "crop", bmp: base, dx: n.x, dy: n.y }); setOpCount(opsRef.current.length)
    baseRef.current = bmp
    shapesRef.current = kept; setShapes(kept)
    cropRef.current = null; setCropSel(null)
    setTool("pen")
    requestAnimationFrame(() => redraw())
  }

  function discard() {
    if (!discardArmed) { setDiscardArmed(true); setTimeout(() => setDiscardArmed(false), 4000); return }
    baseRef.current = null; shapesRef.current = []; setShapes([]); cropRef.current = null; setCropSel(null)
    setTextEdit(null); setHasImage(false); setPhase("idle"); setDiscardArmed(false); setError(null)
    uploadedKeyRef.current = null; opsRef.current = []; setOpCount(0)
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  function exportBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const base = baseRef.current
      if (!base) return reject(new Error("Nothing to save"))
      const c = document.createElement("canvas"); c.width = base.width; c.height = base.height
      const ctx = c.getContext("2d")!
      ctx.drawImage(base, 0, 0)
      for (const s of shapesRef.current) drawShape(ctx, s)
      c.toBlob(b => b ? resolve(b) : reject(new Error("Couldn't make the image")), "image/png")
    })
  }

  async function save() {
    if (!baseRef.current) return
    setPhase("saving"); setError(null)
    try {
      const blob = await exportBlob()
      if (blob.size > MAX_SIZE) throw new Error("That image is too large to save (max 25 MB) — crop it down")
      let key = uploadedKeyRef.current
      if (!key) {
        const r = await fetch("/api/it-tools/screenshots/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: "image/png", size: blob.size }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j?.error ?? "Couldn't get an upload link")
        await putWithProgress(j.url, blob, "image/png")
        key = j.key as string
        uploadedKeyRef.current = key
      }
      const s = await fetch("/api/it-tools/screenshots", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleRef.current.trim(), key, sizeBytes: blob.size, width: baseRef.current.width, height: baseRef.current.height }),
      })
      const sj = await s.json().catch(() => ({}))
      if (!s.ok) {
        if (s.status === 409) uploadedKeyRef.current = null   // storage definitely hasn't got it — upload afresh next time
        throw new Error(sj?.error ?? "Uploaded, but couldn't save it to the list")
      }
      // Saved: clear the editor so the next paste starts clean.
      baseRef.current = null; shapesRef.current = []; setShapes([]); cropRef.current = null; setCropSel(null)
      uploadedKeyRef.current = null; setHasImage(false); setTitle(""); setPhase("saved")
      await load()
    } catch (e: any) {
      setPhase("error"); setError(e?.message ?? "Save failed")
    }
  }

  async function copyImage(source: Blob | Promise<Blob>) {
    try {
      if (!("ClipboardItem" in window)) throw new Error("This browser can't copy images to the clipboard")
      // A promise is accepted so the copy stays inside the click's user-gesture window.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": source })])
      setNotice("Copied — paste it into an email or a message.")
      setTimeout(() => setNotice(n => (n?.startsWith("Copied") ? null : n)), 3000)
    } catch (e: any) { setError(e?.message ?? "Couldn't copy the image") }
  }

  function downloadCurrent() {
    exportBlob().then(b => {
      const a = document.createElement("a")
      a.href = URL.createObjectURL(b); a.download = `${(titleRef.current.trim() || "screenshot").replace(/[^\w.-]+/g, "_")}.png`
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
    }).catch(e => setError(e?.message ?? "Couldn't make the image"))
  }

  async function copySaved(s: Shot) {
    setBusyId(s.id); setActionError(null)
    try {
      await copyImage(fetch(`/api/it-tools/screenshots/${s.id}`).then(r => { if (!r.ok) throw new Error("Couldn't fetch the image"); return r.blob() }))
    } catch (e: any) { setActionError(`${s.title}: ${e?.message ?? "couldn't copy it"}`) }
    setBusyId(null)
  }
  function downloadSaved(s: Shot) {
    const a = document.createElement("a"); a.href = `/api/it-tools/screenshots/${s.id}?download=1`; a.click()
  }
  async function remove(s: Shot) {
    if (!confirm(`Delete "${s.title}"? This removes the file too and can't be undone.`)) return
    setBusyId(s.id); setActionError(null)
    try {
      const r = await fetch(`/api/it-tools/screenshots/${s.id}`, { method: "DELETE" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? "Couldn't delete that screenshot")
      if (viewing?.id === s.id) setViewing(null)
      await load()
    } catch (e: any) { setActionError(`${s.title}: ${e?.message ?? "couldn't delete it"}`) }
    setBusyId(null)
  }

  const busy = phase === "saving" || starting
  const small = "min-h-[44px] px-3 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const primary = `${small} bg-cyan-600 hover:bg-cyan-500 text-white font-semibold`
  const plain = `${small} border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-cyan-500 hover:text-cyan-600 dark:hover:text-cyan-400`
  const toolBtn = (on: boolean) => `${small} text-sm border ${on ? "border-cyan-500 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-cyan-500"}`

  return (
    <div className="space-y-6">

      {/* ── Editor ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">📸 Screenshots</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Capture a screen, paste one in with Ctrl+V, or upload a file. Crop it, mark it up, then save it to the Hub or copy it into an email.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={capture} disabled={busy || !canCapture} title={canCapture === false ? "This browser can't capture the screen — paste or upload instead" : "Pick a screen, window or tab; one picture is taken"}
              className={primary}>{starting ? "Opening the picker…" : "📸 Capture screen"}</button>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className={plain}>⬆ Upload</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = "" }} />
          </div>
        </div>
        {canCapture === false && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            This browser can't capture the screen (the iPads can't, it's a limit of iOS). Paste a screenshot with Ctrl+V or upload one — cropping and mark-up work here.
          </div>
        )}

        {hasImage && (
          <>
            {/* Tools — every one labelled, so the symbols need no separate key */}
            <div className="flex flex-wrap gap-2">
              {TOOLS.map(t => (
                <button key={t.id} onClick={() => { setTool(t.id); if (t.id !== "crop") { cropRef.current = null; setCropSel(null) } }} title={t.hint} className={toolBtn(tool === t.id)}>{t.label}</button>
              ))}
              <span className="w-px bg-gray-300 dark:bg-gray-700 mx-1" aria-hidden />
              {COLOURS.map(([name, hex]) => (
                <button key={hex} onClick={() => setColor(hex)} title={name} aria-label={name}
                  className={`min-h-[44px] min-w-[44px] rounded border-2 ${color === hex ? "border-cyan-500 scale-105" : "border-gray-300 dark:border-gray-700"}`}
                  style={{ background: hex }} />
              ))}
              <span className="w-px bg-gray-300 dark:bg-gray-700 mx-1" aria-hidden />
              {WIDTHS.map(([name, w]) => (
                <button key={w} onClick={() => setWidth(w)} title={`${name} line`} className={toolBtn(width === w)}>{name}</button>
              ))}
              <span className="w-px bg-gray-300 dark:bg-gray-700 mx-1" aria-hidden />
              <button onClick={undo} disabled={!opCount} className={plain} title="Step back — the last drawing, or the last crop">↶ Undo</button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{TOOLS.find(t => t.id === tool)?.hint}</p>

            {/* Canvas */}
            <div className="relative inline-block max-w-full rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 bg-[#0a0a0a]">
              <canvas ref={canvasRef}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                className="block max-w-full h-auto"
                style={{ touchAction: "none", cursor: tool === "text" ? "text" : "crosshair" }} />
              {textEdit && (
                <input ref={textInputRef} value={textEdit.value} onChange={e => setTextEdit({ ...textEdit, value: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") commitText(); if (e.key === "Escape") setTextEdit(null) }}
                  onBlur={commitText} placeholder="Type, then Enter"
                  className="absolute px-2 py-1 rounded bg-white/95 text-gray-900 border border-cyan-500 text-base shadow"
                  style={{ left: textEdit.x / cssScale, top: textEdit.y / cssScale, minWidth: 160 }} />
              )}
            </div>

            {/* Save bar */}
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Title <span className="normal-case font-normal">(optional)</span></span>
                <input value={title} onChange={e => setTitle(e.target.value)} disabled={busy} maxLength={120} placeholder="e.g. Saleroom bid box not updating"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-3 text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-cyan-500 disabled:opacity-60" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button onClick={save} disabled={busy} className={primary}>{phase === "saving" ? "Saving…" : "💾 Save to Hub"}</button>
                <button onClick={() => copyImage(exportBlob())} disabled={busy} className={plain} title="Copy the picture so you can paste it into an email">📋 Copy image</button>
                <button onClick={downloadCurrent} disabled={busy} className={plain}>⬇ Download</button>
                <button onClick={discard} disabled={busy} className={`${small} border ${discardArmed ? "border-red-500 text-red-600 dark:text-red-400 bg-red-500/10" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-red-400"}`}>
                  {discardArmed ? "Really discard?" : "✕ Discard"}
                </button>
              </div>
            </div>
          </>
        )}

        {!hasImage && phase === "saved" && (
          <p className="text-sm text-green-700 dark:text-green-400" aria-live="polite">✓ Saved — it's in the list below.</p>
        )}
        {notice && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">{notice}</div>
        )}
        {error && (
          <div className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[200px]">⚠ {error}</span>
            {phase === "error" && hasImage && (
              <button onClick={save} className={`${small} border border-red-400 hover:bg-red-500/10`}>{uploadedKeyRef.current ? "Try saving it again" : "Try again"}</button>
            )}
          </div>
        )}
      </div>

      {/* ── Saved screenshots ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">Saved screenshots{list ? ` (${list.length})` : ""}</h3>
          <button onClick={load} className={`${small} text-xs text-gray-500 hover:text-cyan-600 dark:hover:text-cyan-400`}>⟳ Refresh</button>
        </div>
        {actionError && <p className="px-5 py-3 text-sm text-red-700 dark:text-red-300 border-b border-red-200 dark:border-red-900/50">⚠ {actionError}</p>}
        {listError ? (
          <p className="px-5 py-4 text-sm text-red-700 dark:text-red-300">⚠ {listError}</p>
        ) : list === null ? (
          <p className="px-5 py-6 text-sm text-gray-500">Loading…</p>
        ) : list.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">No screenshots yet. The first one you save will appear here.</p>
        ) : (
          <div className="grid gap-4 p-5 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {list.map(s => (
              <div key={s.id} className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col">
                <button onClick={() => setViewing(s)} className="block bg-[#0a0a0a] aspect-video overflow-hidden" title="View full size">
                  <img src={`/api/it-tools/screenshots/${s.id}`} alt={s.title} loading="lazy" className="w-full h-full object-contain" />
                </button>
                <div className="p-3 text-sm flex-1">
                  <p className="font-medium text-gray-900 dark:text-white truncate" title={s.title}>{s.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.takenByName} · {fmtWhen(s.createdAt)} · {s.width}×{s.height} · {fmtSize(s.sizeBytes)}</p>
                </div>
                <div className="flex gap-1 p-2 pt-0">
                  <button onClick={() => copySaved(s)} disabled={busyId === s.id} className={`${plain} flex-1 text-xs`} title="Copy the picture to paste elsewhere">📋 Copy</button>
                  <button onClick={() => downloadSaved(s)} disabled={busyId === s.id} className={`${plain} flex-1 text-xs`}>⬇</button>
                  <button onClick={() => remove(s)} disabled={busyId === s.id} className={`${small} text-xs border border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-500/10`}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Viewer ── */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col" onClick={() => setViewing(null)}>
          <div className="flex items-center justify-between gap-3 px-4 py-2 bg-black/60 text-white" onClick={e => e.stopPropagation()}>
            <p className="truncate font-medium">{viewing.title} <span className="text-gray-400 text-sm">· {viewing.takenByName} · {fmtWhen(viewing.createdAt)}</span></p>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => copySaved(viewing)} className={`${small} border border-gray-500 hover:border-cyan-400`}>📋 Copy</button>
              <button onClick={() => downloadSaved(viewing)} className={`${small} border border-gray-500 hover:border-cyan-400`}>⬇ Download</button>
              <button onClick={() => remove(viewing)} className={`${small} border border-red-700 text-red-300 hover:bg-red-500/20`}>Delete</button>
              <button onClick={() => setViewing(null)} className={`${small} border border-gray-500 hover:border-cyan-400`}>✕ Close</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-4">
            <img src={`/api/it-tools/screenshots/${viewing.id}`} alt={viewing.title} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  )
}
