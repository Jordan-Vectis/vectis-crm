"use client"

import { useState, useRef, useEffect } from "react"

const ENVIRONMENTS = [
  { name: "Production", url: "https://vectis-crm-production.up.railway.app", colour: "bg-green-500" },
  { name: "Staging",    url: "https://vectis-staging.up.railway.app",         colour: "bg-orange-400" },
  { name: "Reports",    url: process.env.NEXT_PUBLIC_REPORTS_URL ?? "",        colour: "bg-blue-400" },
]

const BADGE_COLOURS: Record<string, string> = {
  Production: "bg-green-500/20 text-green-400 border-green-500/30",
  Staging:    "bg-orange-400/20 text-orange-300 border-orange-400/30",
  Reports:    "bg-blue-400/20 text-blue-300 border-blue-400/30",
}

export default function EnvSelector() {
  const envName = process.env.NEXT_PUBLIC_ENV_NAME
  if (!envName) return null

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const others = ENVIRONMENTS.filter(e => e.name !== envName && e.url)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`text-xs font-medium px-2 py-1 rounded border ${BADGE_COLOURS[envName] ?? "bg-gray-700 text-gray-300 border-gray-600"} transition-opacity hover:opacity-80`}
      >
        {envName} ▾
      </button>

      {open && others.length > 0 && (
        <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 py-1">
          {others.map(env => (
            <a
              key={env.name}
              href={env.url}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${env.colour}`} />
              {env.name}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
