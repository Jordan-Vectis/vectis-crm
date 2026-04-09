import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getWarehouseRole } from "@/lib/apps"
import WarehouseSidebar from "@/components/warehouse-sidebar"

export default async function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  let whRole: string | null = null
  if (session.user.role === "ADMIN") {
    whRole = "admin"
  } else {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { allowedApps: true, appPermissions: true },
    })
    if (!user || !user.allowedApps.includes("WAREHOUSE")) redirect("/")
    const perms = user.appPermissions as { WAREHOUSE?: { role: string } } | null
    whRole = perms?.WAREHOUSE?.role ?? null
    if (!whRole) redirect("/")
  }

  return (
    <div className="flex h-full w-full">
      <WarehouseSidebar whRole={whRole} />
      <div className="flex-1 overflow-auto bg-gray-50">
        {children}
      </div>
    </div>
  )
}
