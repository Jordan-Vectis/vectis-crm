/**
 * Business Central OData client — delegated OAuth2 (user token from cookie)
 */

import { jwtDecrypt, EncryptJWT } from "jose"
import { cookies } from "next/headers"

const BC_BASE =
  "https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/ODataV4/Company('{company}')/"

function encKey() {
  const buf = Buffer.alloc(32)
  Buffer.from(process.env.NEXTAUTH_SECRET!).copy(buf)
  return buf
}

export interface BCTokenPayload {
  access_token:  string
  refresh_token: string
  expires_at:    number
}

export async function getBCTokenFromCookie(): Promise<string | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get("bc_token")?.value
  if (!raw) return null

  try {
    const { payload } = await jwtDecrypt(raw, encKey())
    const data = payload as unknown as BCTokenPayload

    // Token still valid
    if (data.expires_at > Date.now() + 60_000) {
      return data.access_token
    }

    // Try refresh
    if (data.refresh_token) {
      const refreshed = await refreshBCToken(data.refresh_token)
      if (refreshed) return refreshed
    }

    return null
  } catch {
    return null
  }
}

async function refreshBCToken(refreshToken: string): Promise<string | null> {
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

    const payload: BCTokenPayload = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at:    Date.now() + (tokens.expires_in ?? 3600) * 1000,
    }

    const encrypted = await new EncryptJWT(payload as any)
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime("8h")
      .encrypt(encKey())

    const cookieStore = await cookies()
    cookieStore.set("bc_token", encrypted, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
      path: "/",
    })

    return tokens.access_token
  } catch {
    return null
  }
}

function baseUrl(): string {
  return BC_BASE
    .replace("{tenantId}",   process.env.BC_TENANT_ID ?? "")
    .replace("{environment}", process.env.BC_ENVIRONMENT ?? "production")
    .replace("{company}",    encodeURIComponent(process.env.BC_COMPANY ?? "Vectis"))
}

export async function bcPage(
  token: string,
  endpoint: string,
  params: Record<string, string | number>
): Promise<any[]> {
  const url = new URL(baseUrl() + endpoint)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      Authorization: `Bearer ${token}`,
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
