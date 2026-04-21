import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { getAllowedSections } from "@/lib/apps"
import type { AppKey } from "@/lib/apps"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ appKey: string }> }
) {
  const session = await getEffectiveSession()
  if (!session) return NextResponse.json({ allowed: null })

  const { appKey } = await params
  const allowed = getAllowedSections(
    session.user.role,
    session.user.appPermissions,
    appKey as AppKey
  )
  return NextResponse.json({ allowed })
}
