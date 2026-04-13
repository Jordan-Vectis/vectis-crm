"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import EnvSelector from "@/components/env-selector"

interface TopBarProps {
  userName: string
}

export default function TopBar({ userName }: TopBarProps) {
  const router = useRouter()

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.back()}
          title="Go back"
          className="text-gray-500 hover:text-white text-sm transition-colors px-1"
        >
          ←
        </button>
        <button
          onClick={() => router.forward()}
          title="Go forward"
          className="text-gray-500 hover:text-white text-sm transition-colors px-1"
        >
          →
        </button>
        <Link
          href="/"
          className="text-gray-400 hover:text-white text-sm font-medium transition-colors ml-1"
        >
          Home
        </Link>
        <Link
          href="/contacts"
          className="text-gray-400 hover:text-white text-sm font-medium transition-colors ml-3"
        >
          Customers
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <EnvSelector />
        <span className="text-gray-400 text-xs hidden sm:block">{userName}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
