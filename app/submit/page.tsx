"use client"

import { useState, useTransition, useRef } from "react"
import { submitPublicForm } from "@/lib/actions/public-submission"

export default function PublicSubmitPage() {
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFiles(incoming: FileList | null) {
    if (!incoming) return
    const allowed = ["image/jpeg", "image/png", "application/pdf"]
    const valid = Array.from(incoming).filter((f) => allowed.includes(f.type))
    setFiles((prev) => [...prev, ...valid])
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const formData = new FormData(form)

    // Replace file input with individually appended files
    formData.delete("photos")
    files.forEach((f) => formData.append("photos", f))

    startTransition(async () => {
      try {
        await submitPublicForm(formData)
        setSubmitted(true)
      } catch {
        setError("Something went wrong. Please try again or contact us directly.")
      }
    })
  }

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
            <p className="text-sm text-gray-500 mb-4">Tell us about your item. Enter as much information as possible to help our specialists evaluate your items.</p>
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
            <p className="text-sm text-gray-500 mb-4">Acceptable files — JPG, PNG, PDF</p>

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
              <ul className="mt-3 space-y-2">
                {files.map((file, i) => (
                  <li key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-700 truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-red-400 hover:text-red-600 ml-3 flex-shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {error && (
            <p className="text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 px-6 rounded-lg text-base transition-colors disabled:opacity-50"
          >
            {isPending ? "Submitting..." : "Submit for Valuation"}
          </button>

        </form>
      </div>
    </div>
  )
}
