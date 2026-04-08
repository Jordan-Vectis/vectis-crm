"use client"

import { useTransition } from "react"
import { deleteUser } from "@/lib/actions/admin"

export default function DeleteUserButton({ id, name }: { id: string; name: string }) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (!confirm(`Remove user "${name}"? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteUser(id)
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
    >
      {isPending ? "Removing..." : "Remove"}
    </button>
  )
}
