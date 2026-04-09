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
    <div className="flex h-full">
      <CataloguingSidebar />
      <div className="flex-1 overflow-auto bg-[#141416]">{children}</div>
    </div>
  )
}
