/**
 * Business Central OData client — client_credentials grant (server-side only)
 */

const BC_BASE =
  "https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/ODataV4/Company('{company}')/"

export interface BCConfig {
  tenantId: string
  environment: string
  company: string
  clientId: string
  clientSecret: string
}

let _cachedToken: { token: string; expiresAt: number } | null = null

export async function getBCToken(config: BCConfig): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.token
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://api.businesscentral.dynamics.com/.default",
      }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`BC token error ${res.status}: ${text}`)
  }
  const data = await res.json()
  _cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return _cachedToken.token
}

function baseUrl(config: BCConfig): string {
  return BC_BASE
    .replace("{tenantId}", config.tenantId)
    .replace("{environment}", config.environment)
    .replace("{company}", encodeURIComponent(config.company))
}

export async function bcPage(
  config: BCConfig,
  endpoint: string,
  params: Record<string, string | number>
): Promise<any[]> {
  const token = await getBCToken(config)
  const url = new URL(baseUrl(config) + endpoint)
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
  config: BCConfig,
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
    const rows = await bcPage(config, endpoint, params)
    all.push(...rows)
    if (rows.length < batchSize) break
    skip += batchSize
  }
  return all
}

export function getBCConfig(): BCConfig | null {
  const { BC_TENANT_ID, BC_ENVIRONMENT, BC_COMPANY, BC_CLIENT_ID, BC_CLIENT_SECRET } =
    process.env
  if (!BC_TENANT_ID || !BC_CLIENT_ID || !BC_CLIENT_SECRET) return null
  return {
    tenantId: BC_TENANT_ID,
    environment: BC_ENVIRONMENT ?? "production",
    company: BC_COMPANY ?? "Vectis",
    clientId: BC_CLIENT_ID,
    clientSecret: BC_CLIENT_SECRET,
  }
}
