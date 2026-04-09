import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import EditUserForm from "./edit-user-form"
import DeleteUserButton from "../delete-button"

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/")

  const { id } = await params

  const [user, departments] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { department: true } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ])

  if (!user) notFound()

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/users" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">← Users</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
        <span className="text-sm text-gray-400">{user.email}</span>
      </div>

      <EditUserForm
        userId={user.id}
        name={user.name}
        role={user.role}
        departmentId={user.departmentId}
        allowedApps={user.allowedApps}
        departments={departments}
        isSelf={session.user.id === user.id}
      />

      {session.user.id !== user.id && (
        <div className="mt-6 bg-white rounded-xl border border-red-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-1">Danger Zone</h2>
          <p className="text-sm text-gray-500 mb-4">Permanently delete this user. This cannot be undone.</p>
          <DeleteUserButton id={user.id} name={user.name} redirectAfter="/admin/users" />
        </div>
      )}
    </div>
  )
}
