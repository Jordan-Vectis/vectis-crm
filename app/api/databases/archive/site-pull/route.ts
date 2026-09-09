import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getJob, requestStop, startPhotoCopy, startSitePull, type Scope } from "@/lib/archive-site"

// Databases → Lot Archive: the two website jobs (see lib/archive-site.ts).
//   GET                                   → { site, photos } as they stand
//   POST { job: "site"|"photos", action: "start"|"stop", scope?: "abc"|"bc"|"both" }
// ⚠ scope is which database the run is for. The ABC page sends "abc" and the BC page "bc", so BC
// photos no longer sit behind 948,000 ABC ones.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })
    const [site, photos] = await Promise.all([getJob("site"), getJob("photos")])
    return NextResponse.json({ site, photos })
  } catch (e: any) {
    console.error("databases/archive/site-pull GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })
    const { job, action, scope } = await req.json()
    if (job !== "site" && job !== "photos") return NextResponse.json({ error: "Unknown job" }, { status: 400 })
    const by = session.user?.email ?? "unknown"
    if (action === "stop") { requestStop(job); return NextResponse.json({ ok: true }) }
    if (action !== "start") return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    const sc: Scope = scope === "abc" || scope === "bc" ? scope : "both"
    const j = job === "site" ? await startSitePull(by, sc) : await startPhotoCopy(by, sc)
    return NextResponse.json(j)
  } catch (e: any) {
    console.error("databases/archive/site-pull POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
