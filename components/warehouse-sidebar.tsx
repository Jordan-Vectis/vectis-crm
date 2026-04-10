"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

interface WarehouseSidebarProps {
  whRole: string
}

export default function WarehouseSidebar({ whRole }: WarehouseSidebarProps) {
  const pathname = usePathname()

  if (!pathname.startsWith("/tools/warehouse")) return null

  const links = [
    { href: "/tools/warehouse",           label: "Dashboard",  icon: "🏠", exact: true },
    { href: "/tools/warehouse/inbound",   label: "Inbound",    icon: "📥" },
    { href: "/tools/warehouse/locate",    label: "Locate",     icon: "📍" },
    { href: "/tools/warehouse/warehouse", label: "Lookup",     icon: "🔍" },
    ...(["manager","admin"].includes(whRole) ? [
      { href: "/contacts", label: "Customers", icon: "👥" },
      { href: "/tools/warehouse/receipts",  label: "Receipts",  icon: "📋" },
      { href: "/tools/warehouse/history",   label: "History",   icon: "📅" },
    ] : []),
    ...(whRole === "admin" ? [
      { href: "/tools/warehouse/reports", label: "Reports", icon: "📊" },
    ] : []),
  ]

  return (
    <aside className="w-48 flex-shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col py-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 px-4 mb-3">Warehouse</p>
      <nav className="flex flex-col gap-0.5 px-2">
        {links.map(({ href, label, icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
