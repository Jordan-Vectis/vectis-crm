import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { cookies } from "next/headers"

export const IMPERSONATE_COOKIE = "vectis-impersonate"

export interface EffectiveSession {
  user: {
    id: string
    name: string
    email: string
    role: string
    departmentId: string | null
    appPermissions: Record<string, any> | null
  }
  isImpersonating: boolean
  adminName: string
  adminId: string
}

/**
 * Returns the "effective" session for the current request.
 * When an admin has set the impersonation cookie, returns the target
 * user's data instead so all access checks behave as that user.
 * Non-admin sessions are returned as-is.
 */
export async function getEffectiveSession(): Promise<EffectiveSession | null> {
  const session = await auth()
  if (!session) return null

  const base: EffectiveSession = {
    user: session.user as EffectiveSession["user"],
    isImpersonating: false,
    adminName: session.user.name,
    adminId: session.user.id,
  }

  // Only admins can impersonate
  if (session.user.role !== "ADMIN") return base

  const cookieStore = await cookies()
  const targetId = cookieStore.get(IMPERSONATE_COOKIE)?.value
  if (!targetId) return base

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, email: true, role: true, departmentId: true, appPermissions: true },
  })
  if (!target) return base  // stale cookie — fall back to real session

  return {
    user: {
      id: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      departmentId: target.departmentId,
      appPermissions: target.appPermissions as Record<string, any> | null,
    },
    isImpersonating: true,
    adminName: session.user.name,
    adminId: session.user.id,
  }
}
