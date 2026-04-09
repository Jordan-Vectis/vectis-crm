import { auth } from "@/auth"
import { redirect } from "next/navigation"
import TopBar from "@/components/top-bar"
import CrmSidebar from "@/components/crm-sidebar"
import AdminSidebar from "@/components/admin-sidebar"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect("/login")

  return (
    <div className="flex flex-col h-full min-h-screen">
      <TopBar userName={session.user.name} />
      <div className="flex flex-1 overflow-hidden">
        <CrmSidebar />
        <AdminSidebar />
        <main className="flex-1 overflow-auto bg-gray-50">{children}</main>
      </div>
    </div>
  )
}
