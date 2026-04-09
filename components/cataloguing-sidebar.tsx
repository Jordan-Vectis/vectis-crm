"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"

const links = [
  { href: "/tools/cataloguing/auctions", label: "Auction Manager", icon: "🏷" },
]

export default function CataloguingSidebar() {
  const pathname = usePathname()
  if (!pathname.startsWith("/tools/cataloguing")) return null
  return (
    <aside className="w-48 flex-shrink-0 bg-[#1C1C1E] border-r border-gray-800 flex flex-col py-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 px-4 mb-3">Cataloguing</p>
      <nav className="flex flex-col gap-0.5 px-2">
        {links.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? "bg-[#2AB4A6] text-white" : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}>
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
