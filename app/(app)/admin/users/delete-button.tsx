"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteUser } from "@/lib/actions/admin"

export default function DeleteUserButton({ id, name, redirectAfter }: { id: string; name: string; redirectAfter?: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    if (!confirm(`Remove user "${name}"? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteUser(id)
      if (redirectAfter) router.push(redirectAfter)
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
    >
      {isPending ? "Deleting…" : "Delete User"}
    </button>
  )
}
