import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import Link from "next/link"
import EditUserForm from "./edit-user-form"
import DeleteUserButton from "../delete-button"

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/submissions")

  const { id } = await params
  const [user, departments] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { department: true } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ])

  if (!user) notFound()

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/admin/users" className="text-sm text-gray-500 hover:text-gray-700 mb-1 inline-block">← Users</Link>
          <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        {session.user.id !== user.id && (
          <DeleteUserButton id={user.id} name={user.name} redirectAfter="/admin/users" />
        )}
      </div>

      <EditUserForm
        userId={user.id}
        name={user.name}
        role={user.role}
        departmentId={user.departmentId}
        allowedApps={user.allowedApps}
        appPermissions={user.appPermissions as Record<string, { role: string }> | null}
        departments={departments}
        isSelf={session.user.id === user.id}
      />
    </div>
  )
}
