import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { surveysForUser } from "@/lib/feedback"
import type { MySurveys } from "@/lib/feedback-types"

export const dynamic = "force-dynamic"

// 📝 GET /api/feedback/mine → MySurveys — the survey to pop up for this person, and the ones they
// put off (which drive the temporary top-bar button). Asked by components/feedback-prompt.tsx on
// every page load, for everyone.
//
// ⚠ The REAL signed-in user (auth()), never getEffectiveSession(): an admin "viewing as" a
// cataloguer must not be shown — and then answer — that cataloguer's survey. Answers are named;
// nobody answers on someone else's behalf.
//
// ⚠ Fails safe to "nothing to show", never an error body: this runs on every page load, and
// before Run Migrations creates the tables it would otherwise fail for everyone, all day.

const NOTHING: MySurveys = { popup: null, later: [] }

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const me = await currentUser(session.user.id)
    if (!me) return NextResponse.json(NOTHING)

    return NextResponse.json(await surveysForUser(me), { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("feedback mine GET error:", e)
    return NextResponse.json(NOTHING)
  }
}

/** Role read FRESH from the database — the session token can be hours old, and a survey's
 *  audience is chosen by role. (Same small helper as app/api/feedback/respond/route.ts.) */
async function currentUser(id: string): Promise<{ id: string; role: string } | null> {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } })
  if (!u) return null
  // The same superadmin rule auth.ts applies at sign-in: it@vectis.co.uk is always ADMIN,
  // whatever the table says — otherwise a survey sent to "Admins" would miss him.
  const role = u.email?.toLowerCase() === "it@vectis.co.uk" ? "ADMIN" : String(u.role)
  return { id: u.id, role }
}
