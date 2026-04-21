export type AppKey = "CRM" | "AUCTION_AI" | "CATALOGUING" | "BC_REPORTS" | "SALEROOM_TRAINER" | "WAREHOUSE" | "AUCTION_CONTROLLER"

export const ALL_APPS: { key: AppKey; label: string }[] = [
  { key: "CRM",                label: "CRM" },
  { key: "AUCTION_AI",         label: "Auction AI" },
  { key: "CATALOGUING",        label: "Cataloguing" },
  { key: "BC_REPORTS",         label: "BC Reports" },
  { key: "SALEROOM_TRAINER",   label: "Saleroom Trainer" },
  { key: "WAREHOUSE",          label: "Warehouse" },
  { key: "AUCTION_CONTROLLER", label: "Auction Controller" },
]

export function hasAppAccess(role: string, allowedApps: string[], appKey: AppKey): boolean {
  if (role === "ADMIN") return true
  return allowedApps.includes(appKey)
}

export type WarehouseRole = "warehouse" | "manager" | "admin"

export const WAREHOUSE_ROLES: { value: WarehouseRole; label: string }[] = [
  { value: "warehouse", label: "Warehouse (basic)" },
  { value: "manager",   label: "Manager" },
  { value: "admin",     label: "Admin (full)" },
]

export function getWarehouseRole(
  role: string,
  appPermissions: Record<string, { role: string }> | null | undefined
): WarehouseRole | null {
  if (role === "ADMIN") return "admin"
  return (appPermissions?.WAREHOUSE?.role as WarehouseRole) || null
}

export function canAccessWarehouseRoute(whRole: WarehouseRole | null, minRole: WarehouseRole): boolean {
  if (!whRole) return false
  const order: WarehouseRole[] = ["warehouse", "manager", "admin"]
  return order.indexOf(whRole) >= order.indexOf(minRole)
}

// ─── Cataloguing sidebar items ────────────────────────────────────────────────

export const CATALOGUING_SIDEBAR_ITEMS: { key: string; label: string }[] = [
  { key: "AUCTION_MANAGER",    label: "Auction Manager" },
  { key: "TABLET_CATALOGUING", label: "Tablet Cataloguing" },
]

/** Returns the list of allowed cataloguing sidebar item keys for a user.
 *  ADMIN users get everything. If no restriction is stored, all items are returned. */
export function getCataloguingSidebarItems(
  role: string,
  appPermissions: Record<string, any> | null | undefined
): string[] {
  if (role === "ADMIN") return CATALOGUING_SIDEBAR_ITEMS.map(i => i.key)
  const stored = appPermissions?.CATALOGUING?.sidebarItems as string[] | undefined
  if (!stored || stored.length === 0) return CATALOGUING_SIDEBAR_ITEMS.map(i => i.key)
  return stored
}
