"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ALL_APPS } from "@/lib/apps"
import type { AppKey } from "@/lib/apps"

interface Props {
  userId: string
  userName: string
  currentApps: string[]
  userRole: string
}

export default function AppPermissionsButton({ userId, userName, currentApps, userRole }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(currentApps)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (userRole === "ADMIN") {
    return <span className="text-xs text-gray-400">All (Admin)</span>
  }

  function toggle(key: AppKey) {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/apps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedApps: selected }),
      })
      if (!res.ok) {
        setError("Failed to save permissions.")
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => { setSelected(currentApps); setOpen(true) }}
        className="text-blue-400 hover:text-blue-600 text-sm"
      >
        Edit Apps
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <p className="text-xs font-medium text-gray-600">{userName}</p>
      <div className="flex flex-col gap-1">
        {ALL_APPS.map(app => (
          <label key={app.key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(app.key)}
              onChange={() => toggle(app.key)}
              className="rounded border-gray-300"
            />
            {app.label}
          </label>
        ))}
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
