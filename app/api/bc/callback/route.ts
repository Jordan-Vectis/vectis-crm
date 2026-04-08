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

  const cookieHeader = [
    `bc_token=${encrypted}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 8}`,
    "Path=/",
  ].join("; ")

  const clearState = "bc_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/"

  // Return a 200 HTML page that sets the cookie then JS-redirects.
  // Browsers reliably honour Set-Cookie on 200 responses; they often
  // silently drop them on 3xx redirects (which was causing no_cookie).
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script>window.location.replace("https://vectis-crm-production.up.railway.app/tools/bc-reports?bc_connected=1")</script>
</head><body>Connecting…</body></html>`

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "Set-Cookie":   [cookieHeader, clearState].join(", "),
    },
  })
}
