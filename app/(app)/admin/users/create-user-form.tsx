"use client"

import { useTransition, useState } from "react"
import { createUser } from "@/lib/actions/admin"

interface Props {
  departments: { id: string; name: string }[]
}

export default function CreateUserForm({ departments }: Props) {
  const [isPending, startTransition] = useTransition()
  const [role, setRole] = useState("COLLECTIONS")

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      await createUser(formData)
      ;(e.target as HTMLFormElement).reset()
      setRole("COLLECTIONS")
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Full name</label>
        <input
          name="name"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
        <input
          name="email"
          type="email"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="COLLECTIONS">Collections</option>
          <option value="CATALOGUER">Cataloguer</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>
      {role === "CATALOGUER" && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
          <select
            name="departmentId"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
      >
        {isPending ? "Creating..." : "Create User"}
      </button>
    </form>
  )
}
