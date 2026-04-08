"use client"

import { useState, useTransition, useRef } from "react"
import { submitPublicForm } from "@/lib/actions/public-submission"

const MAX_FILES_SIZE_GB = 5
const MAX_FILES_SIZE_BYTES = MAX_FILES_SIZE_GB * 1024 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"]

interface FileEntry {
  file: File
  key: string | null
  progress: number
  error: string | null
  done: boolean
}

export default function PublicSubmitPage() {
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function getTotalSize(entries: FileEntry[]) {
    return entries.reduce((sum, e) => sum + e.file.size, 0)
  }

  function handleFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter((f) => ALLOWED_TYPES.includes(f.type))
    const newEntries: FileEntry[] = valid.map((f) => ({
      file: f,
      key: null,
      progress: 0,
      error: null,
      done: false,
    }))

    setFiles((prev) => {
      const combined = [...prev, ...newEntries]
      const totalSize = getTotalSize(combined)
      if (totalSize > MAX_FILES_SIZE_BYTES) {
        setError(`Total file size exceeds ${MAX_FILES_SIZE_GB}GB. Please contact us directly if you have a large number of photos.`)
        return prev
      }
      setError(null)
      return combined
    })
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setError(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  async function uploadFile(entry: FileEntry, index: number): Promise<string> {
    // Get signed URL from our server
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: entry.file.name,
        contentType: entry.file.type,
        size: entry.file.size,
      }),
    })

    if (!res.ok) throw new Error("Failed to get upload URL")
    const { url, key } = await res.json()

    // Upload directly to R2 with progress tracking
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("PUT", url)
      xhr.setRequestHeader("Content-Type", entry.file.type)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100)
          setFiles((prev) =>
            prev.map((f, i) => (i === index ? { ...f, progress } : f))
          )
        }
      }

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 204) {
          setFiles((prev) =>
            prev.map((f, i) => (i === index ? { ...f, progress: 100, done: true, key } : f))
          )
          resolve()
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error("Upload failed"))
      xhr.send(entry.file)
    })

    return key
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget

    // Upload all files to R2 first
    setUploading(true)
    const keys: string[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        const key = await uploadFile(files[i], i)
        keys.push(key)
      }
    } catch {
      setError("One or more photos failed to upload. Please try again.")
      setUploading(false)
      return
    }

    setUploading(false)

    // Submit form data with keys
    const formData = new FormData(form)
    keys.forEach((k) => formData.append("photoKey", k))

    startTransition(async () => {
      try {
        await submitPublicForm(formData)
        setSubmitted(true)
      } catch {
        setError("Something went wrong. Please try again or contact us directly.")
      }
    })
  }

  const totalSize = getTotalSize(files)
  const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1)
  const allUploaded = files.every((f) => f.done)
  const isSubmitting = uploading || isPending

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank you!</h2>
          <p className="text-gray-600">
            We've received your submission and one of our specialists will be in touch with a valuation shortly.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Submit Items for Valuation</h1>
          <p className="text-gray-500 mt-2">Fill in your details and describe your items. One of our specialists will get back to you with a valuation.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">

          {/* Your Details */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Your Details</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <select
                  name="title"
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select...</option>
                  <option>Mr</option>
                  <option>Mrs</option>
                  <option>Miss</option>
                  <option>Ms</option>
                  <option>Dr</option>
                  <option>Prof</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First name *</label>
                  <input
                    name="firstName"
                    required
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last name *</label>
                  <input
                    name="lastName"
                    required
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address *</label>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
                <input
                  name="phone"
                  type="tel"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* Item Description */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Item Description</h2>
            <p className="text-sm text-gray-500 mb-4">Tell us about your items. Enter as much information as possible to help our specialists evaluate them.</p>
            <textarea
              name="description"
              required
              rows={6}
              placeholder="Describe your items — include condition, any markings, whether original packaging is present, approximate age, etc."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </section>

          {/* Photographs */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Photographs</h2>
            <p className="text-sm text-gray-500 mb-4">Acceptable files — JPG, PNG, PDF. Maximum {MAX_FILES_SIZE_GB}GB total.</p>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <p className="text-gray-500 mb-3">Add images</p>
              <button
                type="button"
                className="bg-blue-700 hover:bg-blue-800 text-white font-medium px-6 py-2 rounded transition-colors"
              >
                BROWSE
              </button>
              <p className="text-sm text-gray-400 mt-3">or drag and drop files here</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.pdf"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-400">{files.length} file{files.length !== 1 ? "s" : ""} — {totalSizeMB}MB total</p>
                {files.map((entry, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 truncate mr-2">{entry.file.name}</span>
                      {!isSubmitting && (
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="text-red-400 hover:text-red-600 flex-shrink-0 text-xs"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {entry.progress > 0 && (
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${entry.done ? "bg-green-500" : "bg-blue-500"}`}
                          style={{ width: `${entry.progress}%` }}
                        />
                      </div>
                    )}
                    {entry.error && <p className="text-xs text-red-500 mt-0.5">{entry.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {error && (
            <p className="text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 px-6 rounded-lg text-base transition-colors disabled:opacity-50"
          >
            {uploading
              ? `Uploading photos...`
              : isPending
              ? "Submitting..."
              : "Submit for Valuation"}
          </button>

        </form>
      </div>
    </div>
  )
}
