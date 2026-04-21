import { cookies } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { IMPERSONATE_COOKIE } from "@/lib/impersonation"

export default async function ImpersonationBanner() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") return null

  const cookieStore = await cookies()
  const targetId = cookieStore.get(IMPERSONATE_COOKIE)?.value
  if (!targetId) return null

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { name: true, role: true },
  })
  if (!target) return null

  return (
    <div className="flex items-center justify-between gap-4 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-md flex-shrink-0">
      <div className="flex items-center gap-2">
        <span>👁</span>
        <span>
          Viewing as <strong>{target.name}</strong>
          <span className="ml-2 text-xs font-normal opacity-75">({target.role})</span>
        </span>
      </div>
      <form action="/api/admin/impersonate/stop" method="POST">
        <button
          type="submit"
          className="rounded-md bg-amber-900/20 px-3 py-1 text-xs font-semibold hover:bg-amber-900/40 transition-colors border border-amber-800/30"
        >
          ← Return to {session.user.name.split(" ")[0]}
        </button>
      </form>
    </div>
  )
}
