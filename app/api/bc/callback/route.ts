import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { cookies } from "next/headers"
import { EncryptJWT } from "jose"

function encKey() {
  const buf = Buffer.alloc(32)
  Buffer.from(process.env.AUTH_SECRET!).copy(buf)
  return buf
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.redirect(new URL("https://vectis-crm-production.up.railway.app/login"))

  const { searchParams } = req.nextUrl
  const code  = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(
      new URL(`https://vectis-crm-production.up.railway.app/tools/bc-reports?bc_error=${encodeURIComponent(error)}`)
    )
  }

  // Verify state from cookie
  const cookieStore = await cookies()
  const savedState  = cookieStore.get("bc_oauth_state")?.value
  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL("https://vectis-crm-production.up.railway.app/tools/bc-reports?bc_error=invalid_state"))
  }

  const clientId     = process.env.BC_CLIENT_ID!
  const clientSecret = process.env.BC_CLIENT_SECRET!
  const tenantId     = process.env.BC_TENANT_ID!
  const redirectUri  = "https://vectis-crm-production.up.railway.app/api/bc/callback"

  // Exchange code for tokens
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        grant_type:    "authorization_code",
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        code:          code!,
        scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
      }),
    }
  )

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    return NextResponse.redirect(
      new URL(`https://vectis-crm-production.up.railway.app/tools/bc-reports?bc_error=${encodeURIComponent(err)}`)
    )
  }

  const tokens = await tokenRes.json()

  const payload = {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    expires_at:    Date.now() + (tokens.expires_in ?? 3600) * 1000,
  }

  const encrypted = await new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime("8h")
    .encrypt(encKey())

  const response = NextResponse.redirect(new URL("https://vectis-crm-production.up.railway.app/tools/bc-reports?bc_connected=1"))

  // Clear state cookie and set token cookie on the response
  response.cookies.delete("bc_oauth_state")
  response.cookies.set("bc_token", encrypted, {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",
    maxAge:   60 * 60 * 8,
    path:     "/",
  })

  return response
}
