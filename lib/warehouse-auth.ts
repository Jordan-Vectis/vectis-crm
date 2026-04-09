import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import type { WarehouseRole } from "@/lib/apps"

const ROLE_ORDER: WarehouseRole[] = ["warehouse", "manager", "admin"]

export async function requireWarehouseAccess(minRole: WarehouseRole = "warehouse") {
  const session = await auth()
  if (!session) {
    throw new Error("Not authenticated")
  }

  // Vectis ADMIN always has full warehouse admin access
  if (session.user.role === "ADMIN") {
    return { session, whRole: "admin" as WarehouseRole }
  }

  // Check DB directly (always fresh, not cached in session)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { allowedApps: true, appPermissions: true },
  })

  if (!user || !user.allowedApps.includes("WAREHOUSE")) {
    throw new Error("No warehouse access")
  }

  const perms = user.appPermissions as { WAREHOUSE?: { role: string } } | null
  const whRole = perms?.WAREHOUSE?.role as WarehouseRole | undefined

  if (!whRole) {
    throw new Error("No warehouse role assigned")
  }

  if (ROLE_ORDER.indexOf(whRole) < ROLE_ORDER.indexOf(minRole)) {
    throw new Error("Insufficient warehouse role")
  }

  return { session, whRole }
}
