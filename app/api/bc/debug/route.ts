import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken } from "@/lib/bc"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "No BC token" }, { status: 401 })

  const tenantId    = process.env.BC_TENANT_ID
  const environment = process.env.BC_ENVIRONMENT ?? "production"
  const company     = process.env.BC_COMPANY ?? "Vectis"

  // Test 1: no filter — should return first 5 records
  const baseUrl = `https://api.businesscentral.dynamics.com/v2.0/${tenantId}/${environment}/ODataV4/Company('${company}')/ChangeLogEntries`

  const filter = "Date_and_Time ge 2026-04-07T00:00:00Z and Date_and_Time le 2026-04-07T23:59:59Z and Field_Caption eq 'Internal Barcode'"

  const urlNoFilter  = `${baseUrl}?$top=3`
  const urlWithFilter = `${baseUrl}?$top=3&$filter=${encodeURIComponent(filter)}&$select=User_ID,Date_and_Time`
  const urlWithFilterEncoded = `${baseUrl}?%24top=3&%24filter=${encodeURIComponent(filter)}&%24select=User_ID,Date_and_Time`

  const headers = {
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    Authorization: `Bearer ${token}`,
  }

  const [r1, r2, r3] = await Promise.all([
    fetch(urlNoFilter, { headers }).then(async r => ({ status: r.status, count: (await r.json()).value?.length ?? "err" })).catch(e => ({ error: e.message })),
    fetch(urlWithFilter, { headers }).then(async r => ({ status: r.status, count: (await r.json()).value?.length ?? "err" })).catch(e => ({ error: e.message })),
    fetch(urlWithFilterEncoded, { headers }).then(async r => ({ status: r.status, count: (await r.json()).value?.length ?? "err" })).catch(e => ({ error: e.message })),
  ])

  return NextResponse.json({
    urls: { noFilter: urlNoFilter, withFilter: urlWithFilter, withFilterEncoded: urlWithFilterEncoded },
    results: { noFilter: r1, withFilter: r2, withFilterEncoded: r3 },
  })
}
