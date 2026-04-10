import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import type { AppKey } from "@/lib/apps"
import UserMenu from "./user-menu"

const apps: {
  href: string
  label: string
  description: string
  icon: string
  color: string
  border: string
  iconBg: string
  btnBg: string
  glow: string
  soon?: boolean
  appKey?: AppKey
}[] = [
  {
    href:        "/submissions",
    label:       "CRM",
    description: "Manage customer submissions, valuations, follow-ups and logistics.",
    icon:        "📋",
    color:       "blue",
    border:      "border-blue-500",
    iconBg:      "text-blue-400",
    btnBg:       "bg-blue-600 hover:bg-blue-500",
    glow:        "hover:shadow-blue-900/40",
    appKey:      "CRM",
  },
  {
    href:        "/tools/auction-ai",
    label:       "Auction AI",
    description: "Generate lot descriptions from photos using Google Gemini AI.",
    icon:        "✨",
    color:       "amber",
    border:      "border-amber-500",
    iconBg:      "text-amber-400",
    btnBg:       "bg-amber-600 hover:bg-amber-500",
    glow:        "hover:shadow-amber-900/40",
    appKey:      "AUCTION_AI",
  },
  {
    href:        "/tools/cataloguing",
    label:       "Cataloguing",
    description: "Step-by-step lot cataloguing wizard — vendor, barcode, categories, estimates and condition.",
    icon:        "📂",
    color:       "teal",
    border:      "border-teal-500",
    iconBg:      "text-teal-400",
    btnBg:       "bg-teal-600 hover:bg-teal-500",
    glow:        "hover:shadow-teal-900/40",
    appKey:      "CATALOGUING",
  },
  {
    href:        "/tools/bc-reports",
    label:       "BC Reports",
    description: "Business Central reporting — cataloguing, packing and warehouse.",
    icon:        "📊",
    color:       "red",
    border:      "border-red-500",
    iconBg:      "text-red-400",
    btnBg:       "bg-red-600 hover:bg-red-500",
    glow:        "hover:shadow-red-900/40",
    appKey:      "BC_REPORTS",
  },
  {
    href:        "/tools/warehouse",
    label:       "Warehouse",
    description: "Track containers, totes and warehouse locations.",
    icon:        "🏭",
    color:       "cyan",
    border:      "border-cyan-500",
    iconBg:      "text-cyan-400",
    btnBg:       "bg-cyan-600 hover:bg-cyan-500",
    glow:        "hover:shadow-cyan-900/40",
    appKey:      "WAREHOUSE",
  },
  {
    href:        "/admin",
    label:       "Admin",
    description: "Manage users, departments and system settings.",
    icon:        "⚙️",
    color:       "slate",
    border:      "border-slate-500",
    iconBg:      "text-slate-400",
    btnBg:       "bg-slate-600 hover:bg-slate-500",
    glow:        "hover:shadow-slate-900/40",
  },
  {
    href:        "/tools/saleroom-trainer",
    label:       "Saleroom Trainer",
    description: "Interactive training simulator for saleroom clerking.",
    icon:        "🎓",
    color:       "purple",
    border:      "border-purple-500",
    iconBg:      "text-purple-400",
    btnBg:       "bg-purple-600 hover:bg-purple-500",
    glow:        "hover:shadow-purple-900/40",
    appKey:      "SALEROOM_TRAINER",
  },
]

export default async function HomePage() {
  const session = await auth()
  const name    = session?.user?.name?.split(" ")[0] ?? "there"

  const dbUser = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
    : null

  const visibleApps = apps.filter(app => {
    if (!app.appKey) return session?.user?.role === "ADMIN" // admin card
    return hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], app.appKey)
  })

  const fullName = session?.user?.name ?? name

  return (
    <div className="relative min-h-screen bg-[#111318] flex flex-col items-center px-6 py-16">
      <UserMenu name={fullName} />
      {/* Header */}
      <div className="text-center mb-14">
        <h1 className="text-4xl font-bold text-white tracking-tight mb-2">
          Vectis
        </h1>
        <p className="text-gray-400 text-base">
          Welcome back, {name} — select an app to get started
        </p>
      </div>

      {/* App grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full max-w-5xl">
        {visibleApps.map((app) => (
          <div
            key={app.href}
            className={`relative bg-[#1c1f27] border ${app.border} rounded-xl p-6 flex flex-col items-center text-center
              transition-all duration-200 hover:shadow-xl ${app.glow} hover:-translate-y-0.5`}
          >
            {app.soon && (
              <span className="absolute top-3 right-3 text-xs font-medium bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                Coming soon
              </span>
            )}

            {/* Icon */}
            <div className={`text-5xl mb-4 ${app.iconBg}`}>
              {app.icon}
            </div>

            {/* Title */}
            <h2 className={`text-lg font-bold mb-2 text-white`}>
              {app.label}
            </h2>

            {/* Description */}
            <p className="text-gray-400 text-sm leading-relaxed mb-6 flex-1">
              {app.description}
            </p>

            {/* Button */}
            <Link
              href={app.href}
              className={`w-full text-center text-sm font-semibold text-white py-2 px-4 rounded-lg transition-colors ${app.btnBg}`}
            >
              Open {app.label} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
