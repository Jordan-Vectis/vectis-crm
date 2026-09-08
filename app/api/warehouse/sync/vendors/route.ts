import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCTokenAny, bcApiUrl, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

// POST /api/warehouse/sync/vendors
// Pulls vendor (consignor) addresses from Business Central into BcVendor, for
// BC Reports → Vendor Locations. Nothing else in the Hub had a vendor address —
// the warehouse feeds carry vendorNo and vendorName and nothing else.
//
// ⚠⚠ ONE PAGE PER CALL, AND THE CLIENT DRIVES THE LOOP. This is the same shape as the tote syncs
// and it is deliberate: a button that walks thousands of rows inside a single request can only ever
// say "working…", which tells the person nothing and is indistinguishable from a hang. Each call
// does one page, writes it, and hands back a cursor plus a running count, so the screen can show
// real numbers going up. It also keeps every request short, which matters on Railway.
//
// ⚠⚠ TWO ENDPOINTS, AND NEITHER IS ENOUGH ON ITS OWN.
//   • Microsoft's STANDARD `api/v2.0` vendors entity carries the address as a complex object
//     including `countryLetterCode` — the only place BC gives us a country. It is NOT filtered to
//     auction vendors, so it also returns suppliers.
//   • Evo's own `api/evo/base/v1.0` vendors page (AL page 75608 EVA_VendorAPI) IS filtered to
//     auction vendors (`SourceTableView = where(EVA_AuctionVendor = const(true))`) but exposes
//     address / city / county / postCode and NO country at all.
// Phase "standard" runs first for the country; phase "evo" then fills in anyone it missed.
//
// ⚠ The evo phase deliberately does NOT write `countryCode` or `source` on an UPDATE. Its country
// is always null, so including it would wipe the one thing the standard phase was run for.
//
// ⚠ NO COUNTRY IS INFERRED HERE. A blank countryCode is stored blank. The report decides what a
// blank means (a UK-shaped postcode is treated as GB there, visibly).

type Phase = "standard" | "evo"

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim()
  return s || null
}

export async function POST(req: NextRequest) {
  if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCTokenAny()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  let phase: Phase = "standard"
  let nextLink: string | null = null
  let seen = 0
  try {
    const body = await req.json()
    if (body?.phase === "evo" || body?.phase === "standard") phase = body.phase
    if (body?.nextLink) nextLink = String(body.nextLink)
    if (typeof body?.seen === "number") seen = body.seen
  } catch { /* first call, no body */ }

  // One log row per whole run, opened on the first call of the first phase.
  let logId: string | null = null
  if (phase === "standard" && !nextLink) {
    const l = await prisma.warehouseSyncLog.create({ data: { source: "vendors", status: "running" } })
    logId = l.id
  }

  try {
    const url = nextLink ?? await bcApiUrl(
      token,
      phase === "standard" ? "api/v2.0" : "api/evo/base/v1.0",
      "vendors",
    )
    const { rows, nextLink: nl } = await bcPageWithNext(token, url)

    let written = 0
    let withCountry = 0

    for (let i = 0; i < rows.length; i += 20) {
      await Promise.all(rows.slice(i, i + 20).map(async (r: any) => {
        if (phase === "standard") {
          const vendorNo = str(r.number)
          if (!vendorNo) return
          const a = r.address ?? {}
          const country = str(a.countryLetterCode)
          if (country) withCountry++
          const data = {
            vendorNo,
            name:        str(r.displayName),
            address:     str(a.street),
            city:        str(a.city),
            county:      str(a.state),
            postCode:    str(a.postalCode),
            countryCode: country,
            source:      "standard",
          }
          await prisma.bcVendor.upsert({ where: { vendorNo }, update: { ...data, syncedAt: new Date() }, create: data })
          written++
        } else {
          const vendorNo = str(r.no)
          if (!vendorNo) return
          // ⚠ No countryCode and no source here — this feed has no country, so writing it would
          // null out what the standard phase just found.
          const data = {
            vendorNo,
            name:     str(r.name),
            address:  str(r.address),
            address2: str(r.address2),
            city:     str(r.city),
            county:   str(r.county),
            postCode: str(r.postCode),
          }
          await prisma.bcVendor.upsert({
            where:  { vendorNo },
            update: { ...data, syncedAt: new Date() },
            create: { ...data, source: "evo" },
          })
          written++
        }
      }))
    }

    const total = seen + written
    const morePages = !!nl
    const done = !morePages && phase === "evo"

    if (done) {
      await prisma.warehouseSyncLog.updateMany({
        where: { source: "vendors", status: "running" },
        data:  { status: "complete", completedAt: new Date(), itemsProcessed: total },
      })
    }

    return NextResponse.json({
      ok: true,
      phase,
      written,
      total,
      withCountry,
      // What to send back next. null/null means this phase is finished.
      nextPhase: morePages ? phase : (phase === "standard" ? "evo" : null),
      nextLink:  morePages ? nl : null,
      done,
      logId,
    })
  } catch (e: any) {
    // ⚠ The standard endpoint may simply not be published on this tenant. That is not a failure of
    // the whole run — it means no countries, and the evo phase can still supply every address. Tell
    // the client to carry on rather than stopping with an error it cannot act on.
    if (phase === "standard") {
      return NextResponse.json({
        ok: true, phase, written: 0, total: seen, withCountry: 0,
        nextPhase: "evo", nextLink: null, done: false,
        note: `Business Central's standard vendor list is not available (${e?.message ?? "unknown"}), so no countries could be read. Carrying on with the auction vendor list.`,
      })
    }
    await prisma.warehouseSyncLog.updateMany({
      where: { source: "vendors", status: "running" },
      data:  { status: "failed", completedAt: new Date(), error: e.message },
    })
    return NextResponse.json({ error: e.message, phase }, { status: 500 })
  }
}

// GET — probe. Shows what each endpoint returns for one vendor, so the field names can be checked
// against a live tenant instead of assumed. Admin-only.
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }
  const token = await getBCTokenAny()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const out: Record<string, any> = {}
  for (const [key, path] of [["standard", "api/v2.0"], ["evo", "api/evo/base/v1.0"]] as const) {
    try {
      const url = await bcApiUrl(token, path, "vendors")
      const { rows } = await bcPageWithNext(token, `${url}?$top=1`)
      out[key] = { ok: true, fields: rows[0] ? Object.keys(rows[0]) : [], sample: rows[0] ?? null }
    } catch (e: any) {
      out[key] = { ok: false, error: e?.message ?? "unknown" }
    }
  }
  return NextResponse.json(out)
}
