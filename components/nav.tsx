"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"

interface NavProps {
  userRole: string
  userName: string
}

const navItems = [
  { href: "/submissions", label: "Submissions", roles: ["ADMIN", "COLLECTIONS", "CATALOGUER"] },
  { href: "/cataloguer", label: "My Valuations", roles: ["ADMIN", "CATALOGUER"] },
  { href: "/follow-ups", label: "Follow-ups", roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/admin/users", label: "Users", roles: ["ADMIN"] },
  { href: "/admin/departments", label: "Departments", roles: ["ADMIN"] },
]

export default function Nav({ userRole, userName }: NavProps) {
  const pathname = usePathname()

  const visible = navItems.filter((item) => item.roles.includes(userRole))

  return (
    <nav className="w-56 min-h-screen bg-gray-900 flex flex-col">
      <div className="px-5 py-5 border-b border-gray-700">
        <p className="text-white font-semibold text-sm">Vectis CRM</p>
        <p className="text-gray-400 text-xs mt-0.5">Collections</p>
      </div>

      <div className="flex-1 px-3 py-4 space-y-1">
        {visible.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      <div className="px-3 py-4 border-t border-gray-700">
        <div className="px-3 mb-2">
          <p className="text-white text-xs font-medium truncate">{userName}</p>
          <p className="text-gray-400 text-xs capitalize">{userRole.toLowerCase()}</p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-left px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
