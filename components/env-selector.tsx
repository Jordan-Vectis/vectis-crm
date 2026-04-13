"use client"

import { useState, useRef, useEffect } from "react"

const ENVIRONMENTS = [
  { name: "Production", url: "https://vectis-crm-production.up.railway.app" },
  { name: "Staging",    url: "https://vectis-staging.up.railway.app" },
]

export default function EnvSelector() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-gray-400 hover:text-white text-sm transition-colors"
      >
        Environments ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 py-1">
          {ENVIRONMENTS.map(env => (
            <a
              key={env.name}
              href={env.url}
              className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            >
              {env.name}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
