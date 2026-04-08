import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Nav from "@/components/nav"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect("/login")

  return (
    <div className="flex h-full min-h-screen">
      <Nav userRole={session.user.role} userName={session.user.name} />
      <main className="flex-1 overflow-auto bg-gray-50">{children}</main>
    </div>
  )
}
