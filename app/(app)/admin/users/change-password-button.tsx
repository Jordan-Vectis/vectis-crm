"use client"

import { useState, useTransition } from "react"
import { updateUser } from "@/lib/actions/admin"

export default function ChangePasswordButton({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    setError(null)
    const formData = new FormData()
    formData.set("name", userName)
    formData.set("password", password)
    startTransition(async () => {
      await updateUser(userId, formData)
      setOpen(false)
      setPassword("")
      setConfirm("")
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-blue-400 hover:text-blue-600 text-sm"
      >
        Change password
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 min-w-0">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password"
        minLength={8}
        required
        className="rounded border border-gray-300 px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm password"
        required
        className="rounded border border-gray-300 px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <span className="text-xs text-red-500">{error}</span>}
      <div className="flex gap-2">
        <button
          type="submit"
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
    </form>
  )
}
