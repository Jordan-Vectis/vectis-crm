"use client"

import { signOut } from "next-auth/react"

export default function UserMenu({ name }: { name: string }) {
  return (
    <div className="absolute top-5 right-6 flex items-center gap-3">
      <span className="text-gray-500 text-sm hidden sm:block">{name}</span>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="text-sm text-gray-400 hover:text-white transition-colors"
      >
        Sign out
      </button>
      <span className="text-gray-700 text-xs">|</span>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="text-sm text-gray-400 hover:text-white transition-colors"
      >
        Change user
      </button>
    </div>
  )
}
