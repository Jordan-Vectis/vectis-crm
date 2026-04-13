"use client"

import { useTransition } from "react"
import { deleteDepartment } from "@/lib/actions/admin"

export default function DeleteDepartmentButton({ id, name }: { id: string; name: string }) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (!confirm(`Delete department "${name}"? Cataloguers in this department will be unassigned.`)) return
    startTransition(async () => {
      await deleteDepartment(id)
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
    >
      {isPending ? "Deleting..." : "Delete"}
    </button>
  )
}
