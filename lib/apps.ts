export type AppKey = "CRM" | "AUCTION_AI" | "CATALOGUING" | "BC_REPORTS" | "SALEROOM_TRAINER" | "WAREHOUSE"

export const ALL_APPS: { key: AppKey; label: string }[] = [
  { key: "CRM",              label: "CRM" },
  { key: "AUCTION_AI",       label: "Auction AI" },
  { key: "CATALOGUING",      label: "Cataloguing" },
  { key: "BC_REPORTS",       label: "BC Reports" },
  { key: "SALEROOM_TRAINER", label: "Saleroom Trainer" },
  { key: "WAREHOUSE",        label: "Warehouse" },
]

export function hasAppAccess(role: string, allowedApps: string[], appKey: AppKey): boolean {
  if (role === "ADMIN") return true
  return allowedApps.includes(appKey)
}
