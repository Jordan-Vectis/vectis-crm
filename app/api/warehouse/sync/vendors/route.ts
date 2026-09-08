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
// ⚠⚠ TWO ENDPOINTS, AND NEITHER IS PERFECT ON ITS OWN.
//   • Microsoft's STANDARD `api/v2.0` vendors entity carries the address as a complex object
//     including `countryLetterCode` — the only place BC gives us a country. It is NOT filtered to
//     auction vendors, so it also returns suppliers.
//   • Evo's own `api/evo/base/v1.0` vendors page (AL page 75608 EVA_VendorAPI) IS filtered to
//     auction vendors (`SourceTableView = where(EVA_AuctionVendor = const(true))`) but exposes
//     address / city / county / postCode and NO country at all.
// So the standard one is read first for the country, and Evo's fills in anyone it missed. Which
// answered is recorded per row in `source`, so a report that looks wrong can be traced back.
//
// ⚠ Scoping to "the C numbers actually on receipts" is NOT done here. It is done in the report,
// against the receipt data we already sync. Storing every vendor BC knows costs nothing and means
// the report can change its mind about scope without a re-sync.
//
// ⚠ NO COUNTRY IS INFERRED HERE. A blank countryCode is stored blank. The report decides what a
// blank means (a UK-shaped postcode is treated as GB there, visibly).

type VendorRow = {
  vendorNo: string
  name?: string | null
  address?: string | null
  address2?: string | null
  city?: string | null
  county?: string | null
  postCode?: string | null
  countryCode?: string | null
  source: string
}

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim()
  return s || null
}

/** Walk every page of an entity set, following @odata.nextLink. */
async function walk(token: string, startUrl: string, budgetMs: number): Promise<any[]> {
  const out: any[] = []
  const started = Date.now()
  let link: string | null = startUrl
  while (link) {
    if (Date.now() - started > budgetMs) break
    const { rows, nextLink }: { rows: any[]; nextLink: string | null } = await bcPageWithNext(token, link)
    out.push(...rows)
    link = nextLink
    if (!rows.length) break
  }
  return out
}

export async function POST(req: NextRequest) {
  if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCTokenAny()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const syncLog = await prisma.warehouseSyncLog.create({ data: { source: "vendors", status: "running" } })
  const notes: string[] = []
  const byNo = new Map<string, VendorRow>()

  try {
    // ── 1. Microsoft's standard vendors entity — the only source of a country ────────────────
    try {
      const url  = await bcApiUrl(token, "api/v2.0", "vendors")
      const rows = await walk(token, url, 90_000)
      for (const r of rows) {
        const vendorNo = str(r.number)
        if (!vendorNo) continue
        const a = r.address ?? {}
        byNo.set(vendorNo.toUpperCase(), {
          vendorNo,
          name:        str(r.displayName),
          address:     str(a.street),
          address2:    null,
          city:        str(a.city),
          county:      str(a.state),
          postCode:    str(a.postalCode),
          countryCode: str(a.countryLetterCode),
          source:      "standard",
        })
      }
      notes.push(`standard api: ${rows.length} vendors`)
    } catch (e: any) {
      // Not fatal — Evo's page below still gives us everything except the country.
      notes.push(`standard api unavailable: ${e?.message ?? "unknown"}`)
    }

    // ── 2. Evo's auction-vendor page — richer address, no country ────────────────────────────
    try {
      const url  = await bcApiUrl(token, "api/evo/base/v1.0", "vendors")
      const rows = await walk(token, url, 90_000)
      for (const r of rows) {
        const vendorNo = str(r.no)
        if (!vendorNo) continue
        const key  = vendorNo.toUpperCase()
        const prev = byNo.get(key)
        byNo.set(key, {
          vendorNo,
          name:     str(r.name) ?? prev?.name ?? null,
          address:  str(r.address)  ?? prev?.address  ?? null,
          address2: str(r.address2) ?? prev?.address2 ?? null,
          city:     str(r.city)     ?? prev?.city     ?? null,
          county:   str(r.county)   ?? prev?.county   ?? null,
          postCode: str(r.postCode) ?? prev?.postCode ?? null,
          // Evo's page has no country field at all — keep whatever the standard one found.
          countryCode: prev?.countryCode ?? null,
          source:      prev ? "standard+evo" : "evo",
        })
      }
      notes.push(`evo api: ${rows.length} auction vendors`)
    } catch (e: any) {
      notes.push(`evo api unavailable: ${e?.message ?? "unknown"}`)
    }

    if (byNo.size === 0) {
      const msg = `No vendors returned. ${notes.join(" · ")}`
      await prisma.warehouseSyncLog.update({
        where: { id: syncLog.id },
        data:  { status: "failed", completedAt: new Date(), error: msg, itemsProcessed: 0 },
      })
      return NextResponse.json({ error: msg, notes }, { status: 502 })
    }

    // ── 3. Write ─────────────────────────────────────────────────────────────────────────────
    const all = [...byNo.values()]
    for (let i = 0; i < all.length; i += 20) {
      await Promise.all(all.slice(i, i + 20).map(v => prisma.bcVendor.upsert({
        where:  { vendorNo: v.vendorNo },
        update: { ...v, syncedAt: new Date() },
        create: v,
      })))
    }

    const withCountry = all.filter(v => v.countryCode).length
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data:  { status: "complete", completedAt: new Date(), itemsProcessed: all.length },
    })
    return NextResponse.json({
      ok: true, itemsProcessed: all.length, withCountry, notes,
    })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data:  { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed: 0 },
    })
    return NextResponse.json({ error: e.message, notes }, { status: 500 })
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
  for (const [key, path, set] of [["standard", "api/v2.0", "vendors"], ["evo", "api/evo/base/v1.0", "vendors"]] as const) {
    try {
      const url = await bcApiUrl(token, path, set)
      const { rows } = await bcPageWithNext(token, `${url}?$top=1`)
      out[key] = { ok: true, fields: rows[0] ? Object.keys(rows[0]) : [], sample: rows[0] ?? null }
    } catch (e: any) {
      out[key] = { ok: false, error: e?.message ?? "unknown" }
    }
  }
  return NextResponse.json(out)
}
