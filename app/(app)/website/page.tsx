"use client"

import { useState } from "react"

const PAGES = [
  { label: "Auctions",  path: "/auctions" },
  { label: "Login",     path: "/portal/login" },
  { label: "Register",  path: "/portal/register" },
  { label: "My Account",path: "/account" },
]

export default function WebsitePreviewPage() {
  const [currentPath, setCurrentPath] = useState("/auctions")

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const src = `${origin}${currentPath}`

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#1C1C1E] border-b border-gray-700 shrink-0">
        {/* Quick nav tabs */}
        <div className="flex items-center gap-1">
          {PAGES.map(p => (
            <button
              key={p.path}
              onClick={() => setCurrentPath(p.path)}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                currentPath === p.path
                  ? "bg-[#2AB4A6] text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-2 bg-[#2C2C2E] border border-gray-700 rounded px-3 py-1.5">
          <span className="text-gray-500 text-xs">🌐</span>
          <span className="text-gray-300 text-xs font-mono truncate">{src}</span>
        </div>

        {/* Open in new tab */}
        <a
          href={currentPath}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors border border-gray-700 px-3 py-1.5 rounded hover:border-gray-500"
        >
          Open in tab
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* iframe */}
      <iframe
        key={src}
        src={src}
        className="flex-1 w-full border-0 bg-white"
        title="Website Preview"
      />
    </div>
  )
}
