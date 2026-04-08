/**
 * Business Central OData client — delegated OAuth2 (user token from DB)
 */

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const BC_BASE =
  "https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/ODataV4/Company('{company}')/"

function baseUrl(): string {
  return BC_BASE
    .replace("{tenantId}",    process.env.BC_TENANT_ID ?? "")
    .replace("{environment}", process.env.BC_ENVIRONMENT ?? "production")
    .replace("{company}",     encodeURIComponent(process.env.BC_COMPANY ?? "Vectis"))
}

async function refreshBCToken(userId: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${process.env.BC_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "refresh_token",
          client_id:     process.env.BC_CLIENT_ID!,
          client_secret: process.env.BC_CLIENT_SECRET!,
          refresh_token: refreshToken,
          scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
        }),
      }
    )
    if (!res.ok) return null
    const tokens = await res.json()

    await prisma.bCToken.update({
      where: { userId },
      data: {
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token ?? refreshToken,
        expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      },
    })

    return tokens.access_token
  } catch {
    return null
  }
}

export async function getBCToken(): Promise<string | null> {
  const session = await auth()
  if (!session) return null

  const record = await prisma.bCToken.findUnique({ where: { userId: session.user.id } })
  if (!record) return null

  // Token still valid (with 60s buffer)
  if (record.expiresAt.getTime() > Date.now() + 60_000) {
    return record.accessToken
  }

  // Try refresh
  if (record.refreshToken) {
    return refreshBCToken(session.user.id, record.refreshToken)
  }

  return null
}

export async function bcPage(
  token: string,
  endpoint: string,
  params: Record<string, string | number>
): Promise<any[]> {
  // Build query string manually:
  // - Keep OData keys ($filter, $top, etc.) unencoded — BC ignores %24filter
  // - Encode values with encodeURIComponent so spaces become %20 (not +)
  const base = baseUrl() + endpoint
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&")
  const urlStr = qs ? `${base}?${qs}` : base
  const res = await fetch(urlStr, {
    headers: {
      Accept:            "application/json",
      "OData-MaxVersion": "4.0",
      Authorization:     `Bearer ${token}`,
    },
  })
  if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`)
  return (await res.json()).value ?? []
}

export async function bcFetchAll(
  token: string,
  endpoint: string,
  filter?: string,
  select?: string,
  batchSize = 500
): Promise<any[]> {
  const all: any[] = []
  let skip = 0
  while (true) {
    const params: Record<string, string | number> = { $top: batchSize, $skip: skip }
    if (filter) params.$filter = filter
    if (select) params.$select = select
    const rows = await bcPage(token, endpoint, params)
    all.push(...rows)
    if (rows.length < batchSize) break
    skip += batchSize
  }
  return all
}
