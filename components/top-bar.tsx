"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"

interface TopBarProps {
  userRole: string
  userName: string
}

const crmItems = [
  { href: "/submissions", label: "Submissions",   roles: ["ADMIN", "COLLECTIONS", "CATALOGUER"] },
  { href: "/cataloguer",  label: "My Valuations", roles: ["ADMIN", "CATALOGUER"] },
  { href: "/follow-ups",  label: "Follow-ups",    roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/admin/users", label: "Users",         roles: ["ADMIN"] },
  { href: "/admin/departments", label: "Departments", roles: ["ADMIN"] },
]

const toolItems = [
  { href: "/tools/auction-ai",       label: "Auction AI",       roles: ["ADMIN", "CATALOGUER", "COLLECTIONS"] },
  { href: "/tools/barcode-sorter",   label: "Barcode Sorter",   roles: ["ADMIN", "CATALOGUER", "COLLECTIONS"] },
  { href: "/tools/bc-reports",       label: "BC Reports",       roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/tools/warehouse",        label: "Warehouse",        roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/tools/saleroom-trainer", label: "Saleroom Trainer", roles: ["ADMIN", "CATALOGUER", "COLLECTIONS"] },
]

export default function TopBar({ userRole, userName }: TopBarProps) {
  const pathname  = usePathname()
  const allItems  = [...crmItems, ...toolItems].filter((i) => i.roles.includes(userRole))

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-700 flex items-center px-4 gap-4 flex-shrink-0">
      {/* Home button */}
      <Link
        href="/"
        className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-medium transition-colors whitespace-nowrap"
      >
        ← Home
      </Link>

      <div className="w-px h-5 bg-gray-700" />

      {/* Nav links */}
      <nav className="flex items-center gap-1 overflow-x-auto flex-1 scrollbar-none">
        {allItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="w-px h-5 bg-gray-700" />

      {/* User + sign out */}
      <div className="flex items-center gap-3 flex-shrink-0">
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
