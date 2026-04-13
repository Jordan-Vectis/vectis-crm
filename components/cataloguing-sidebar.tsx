"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"

const links = [
  { href: "/tools/cataloguing/auctions", label: "Auction Manager", icon: "🏷" },
]

interface Props {
  onClose?: () => void
}

export default function CataloguingSidebar({ onClose }: Props = {}) {
  const pathname = usePathname()
  if (!pathname.startsWith("/tools/cataloguing")) return null
  return (
    <aside className="w-48 h-full bg-[#1C1C1E] border-r border-gray-800 flex flex-col py-4">
      <div className="flex items-center justify-between px-4 mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Cataloguing</p>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none">
            ✕
          </button>
        )}
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {links.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link key={href} href={href} onClick={onClose}
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
