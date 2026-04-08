import { auth } from "@/auth"
import { redirect } from "next/navigation"
import TopBar from "@/components/top-bar"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect("/login")

  return (
    <div className="flex flex-col h-full min-h-screen">
      <TopBar userRole={session.user.role} userName={session.user.name} />
      <main className="flex-1 overflow-auto bg-gray-50">{children}</main>
    </div>
  )
}
