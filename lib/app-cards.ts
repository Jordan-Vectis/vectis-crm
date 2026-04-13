import type { AppKey } from "@/lib/apps"

export type AppCardDef = {
  key: string
  href: string
  defaultLabel: string
  defaultDescription: string
  icon: string
  border: string
  iconBg: string
  btnBg: string
  glow: string
  appKey?: AppKey // undefined = admin-only card
  allUsers?: boolean // true = visible to all logged-in users regardless of role/apps
  comingSoon?: boolean
}

export const APP_CARD_DEFS: AppCardDef[] = [
  {
    key:                "CUSTOMERS",
    href:               "/contacts",
    defaultLabel:       "Customers",
    defaultDescription: "Unified customer database — view seller history, buyer activity, and contact details in one place.",
    icon:               "👥",
    border:             "border-green-500",
    iconBg:             "text-green-400",
    btnBg:              "bg-green-600 hover:bg-green-500",
    glow:               "hover:shadow-green-900/40",
    allUsers:           true,
  },
  {
    key:                "CRM",
    href:               "/submissions",
    defaultLabel:       "CRM",
    defaultDescription: "Manage customer submissions, valuations, follow-ups and logistics.",
    icon:               "📋",
    border:             "border-blue-500",
    iconBg:             "text-blue-400",
    btnBg:              "bg-blue-600 hover:bg-blue-500",
    glow:               "hover:shadow-blue-900/40",
    appKey:             "CRM",
  },
  {
    key:                "AUCTION_AI",
    href:               "/tools/auction-ai",
    defaultLabel:       "Auction AI",
    defaultDescription: "Generate lot descriptions from photos using Google Gemini AI.",
    icon:               "✨",
    border:             "border-amber-500",
    iconBg:             "text-amber-400",
    btnBg:              "bg-amber-600 hover:bg-amber-500",
    glow:               "hover:shadow-amber-900/40",
    appKey:             "AUCTION_AI",
  },
  {
    key:                "CATALOGUING",
    href:               "/tools/cataloguing",
    defaultLabel:       "Cataloguing",
    defaultDescription: "Step-by-step lot cataloguing wizard — vendor, barcode, categories, estimates and condition.",
    icon:               "📂",
    border:             "border-teal-500",
    iconBg:             "text-teal-400",
    btnBg:              "bg-teal-600 hover:bg-teal-500",
    glow:               "hover:shadow-teal-900/40",
    appKey:             "CATALOGUING",
  },
  {
    key:                "BC_REPORTS",
    href:               "/tools/bc-reports",
    defaultLabel:       "BC Reports",
    defaultDescription: "Business Central reporting — cataloguing, packing and warehouse.",
    icon:               "📊",
    border:             "border-red-500",
    iconBg:             "text-red-400",
    btnBg:              "bg-red-600 hover:bg-red-500",
    glow:               "hover:shadow-red-900/40",
    appKey:             "BC_REPORTS",
  },
  {
    key:                "WAREHOUSE",
    href:               "/tools/warehouse",
    defaultLabel:       "Warehouse",
    defaultDescription: "Track containers, totes and warehouse locations.",
    icon:               "🏭",
    border:             "border-cyan-500",
    iconBg:             "text-cyan-400",
    btnBg:              "bg-cyan-600 hover:bg-cyan-500",
    glow:               "hover:shadow-cyan-900/40",
    appKey:             "WAREHOUSE",
  },
  {
    key:                "ADMIN",
    href:               "/admin",
    defaultLabel:       "Admin",
    defaultDescription: "Manage users, departments and system settings.",
    icon:               "⚙️",
    border:             "border-slate-500",
    iconBg:             "text-slate-400",
    btnBg:              "bg-slate-600 hover:bg-slate-500",
    glow:               "hover:shadow-slate-900/40",
    // no appKey — admin-only
  },
  {
    key:                "PACKING_DISPATCH",
    href:               "#",
    defaultLabel:       "Packing / Dispatch",
    defaultDescription: "Manage packing lists and dispatch for outgoing lots.",
    icon:               "📦",
    border:             "border-orange-500",
    iconBg:             "text-orange-400",
    btnBg:              "bg-orange-600 hover:bg-orange-500",
    glow:               "hover:shadow-orange-900/40",
    allUsers:           true,
    comingSoon:         true,
  },
  {
    key:                "SALEROOM_TRAINER",
    href:               "/tools/saleroom-trainer",
    defaultLabel:       "Saleroom Trainer",
    defaultDescription: "Interactive training simulator for saleroom clerking.",
    icon:               "🎓",
    border:             "border-purple-500",
    iconBg:             "text-purple-400",
    btnBg:              "bg-purple-600 hover:bg-purple-500",
    glow:               "hover:shadow-purple-900/40",
    appKey:             "SALEROOM_TRAINER",
  },
]
