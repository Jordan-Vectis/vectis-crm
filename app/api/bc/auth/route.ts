import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { cookies } from "next/headers"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const clientId  = process.env.BC_CLIENT_ID!
  const tenantId  = process.env.BC_TENANT_ID!
  const baseUrl   = process.env.NEXTAUTH_URL ?? "https://vectis-crm-production.up.railway.app"
  const redirectUri = `${baseUrl}/api/bc/callback`

  const state = crypto.randomUUID()

  // Store state in cookie to verify on callback
  const cookieStore = await cookies()
  cookieStore.set("bc_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 300, // 5 min
    path: "/",
  })

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
    state,
    response_mode: "query",
  })

  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
  return NextResponse.redirect(authUrl)
}
