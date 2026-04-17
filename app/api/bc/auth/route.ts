import { NextResponse } from "next/server"
import { auth } from "@/auth"

export async function GET() {
  try {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const clientId    = process.env.BC_CLIENT_ID!
  const tenantId    = process.env.BC_TENANT_ID!
  const appUrl      = process.env.NEXTAUTH_URL ?? "https://vectis-production.up.railway.app"
  const redirectUri = `${appUrl}/api/bc/callback`
  const state       = crypto.randomUUID()

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
    state,
    response_mode: "query",
  })

  const authUrl  = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
  const response = NextResponse.redirect(authUrl)

  // Set state cookie on the response itself
  response.cookies.set("bc_oauth_state", state, {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",
    maxAge:   300,
    path:     "/",
  })

  return response
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 })
  }
}
