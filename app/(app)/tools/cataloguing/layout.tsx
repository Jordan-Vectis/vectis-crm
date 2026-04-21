import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess, getCataloguingSidebarItems } from "@/lib/apps"
import CataloguingShell from "@/components/cataloguing-shell"
import { getEffectiveSession } from "@/lib/impersonation"

export default async function CataloguingLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { allowedApps: true, role: true, appPermissions: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "CATALOGUING")) redirect("/hub")
  const allowedSidebarItems = getCataloguingSidebarItems(
    dbUser?.role ?? "",
    dbUser?.appPermissions as Record<string, any> | null
  )
  return <CataloguingShell allowedSidebarItems={allowedSidebarItems}>{children}</CataloguingShell>
}
