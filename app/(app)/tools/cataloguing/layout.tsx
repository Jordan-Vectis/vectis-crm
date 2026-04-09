import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import CataloguingSidebar from "@/components/cataloguing-sidebar"

export default async function CataloguingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "CATALOGUING")) redirect("/")
  return (
    <div className="flex flex-1 min-h-0">
      <CataloguingSidebar />
      <div className="flex-1 overflow-auto bg-gray-50">{children}</div>
    </div>
  )
}
