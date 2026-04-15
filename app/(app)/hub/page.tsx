import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { APP_CARD_DEFS } from "@/lib/app-cards"
import Logo from "@/components/logo"
import UserMenu from "./user-menu"

export default async function HubPage() {
  const session = await auth()
  const name     = session?.user?.name?.split(" ")[0] ?? "there"
  const fullName = session?.user?.name ?? name

  const dbUser = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
    : null

  const dbCards = await prisma.appCard.findMany()
  const dbMap   = Object.fromEntries(dbCards.map(c => [c.key, c]))

  // Merge DB settings with static defaults
  const cards = APP_CARD_DEFS
    .map((def, i) => {
      const db = dbMap[def.key]
      return {
        ...def,
        order:       db?.order   ?? i,
        visible:     db?.visible ?? true,
        pinned:      db?.pinned  ?? false,
        label:       db?.label   || def.defaultLabel,
        description: db?.description || def.defaultDescription,
      }
    })
    // Sort: pinned first, then by order
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.order - b.order
    })
    // Filter hidden
    .filter(c => c.visible)
    // Filter by access
    .filter(c => {
      if (c.allUsers) return true
      if (!c.appKey) return dbUser?.role === "ADMIN"
      return hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], c.appKey)
    })

  return (
    <div className="relative min-h-screen bg-[#111318] flex flex-col items-center px-6 py-16">
      <UserMenu name={fullName} />

      <div className="flex flex-col items-center mb-14 gap-4">
        <Logo variant="full" />
        <p className="text-gray-400 text-base">
          Welcome back, {name} — select an app to get started
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full max-w-6xl">
        {cards.map((app) => (
          <div
            key={app.key}
            className={`relative bg-[#1c1f27] border ${app.border} rounded-xl p-7 flex flex-col items-center text-center h-[260px]
              transition-all duration-200 hover:shadow-xl ${app.glow} hover:-translate-y-0.5`}
          >
            {app.pinned && (
              <span className="absolute top-3 right-3 text-xs font-medium bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">
                ★ Featured
              </span>
            )}

            <div className={`text-5xl mb-4 ${app.iconBg}`}>{app.icon}</div>

            <h2 className="text-lg font-bold mb-2 text-white">{app.label}</h2>

            <p className="text-gray-400 text-sm leading-relaxed mb-6 flex-1">{app.description}</p>

            {app.comingSoon ? (
              <span className="w-full text-center text-sm font-semibold text-gray-500 bg-gray-800 py-2 px-4 rounded-lg cursor-not-allowed">
                Coming Soon
              </span>
            ) : (
              <Link
                href={app.href}
                className={`w-full text-center text-sm font-semibold text-white py-2 px-4 rounded-lg transition-colors ${app.btnBg}`}
              >
                Open {app.label} →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
