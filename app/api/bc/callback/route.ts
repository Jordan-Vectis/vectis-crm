import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"

const APP_URL = process.env.NEXTAUTH_URL ?? "https://vectis-crm-production.up.railway.app"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.redirect(new URL(`${APP_URL}/login`))

  const { searchParams } = req.nextUrl
  const code  = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(
      new URL(`${APP_URL}/tools/bc-reports?bc_error=${encodeURIComponent(error)}`)
    )
  }

  // Verify state from cookie
  const cookieStore = await cookies()
  const savedState  = cookieStore.get("bc_oauth_state")?.value
  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL(`${APP_URL}/tools/bc-reports?bc_error=invalid_state`))
  }

  const clientId     = process.env.BC_CLIENT_ID!
  const clientSecret = process.env.BC_CLIENT_SECRET!
  const tenantId     = process.env.BC_TENANT_ID!
  const redirectUri  = `${APP_URL}/api/bc/callback`

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
      new URL(`${APP_URL}/tools/bc-reports?bc_error=${encodeURIComponent(err)}`)
    )
  }

  const tokens = await tokenRes.json()

  await prisma.bCToken.upsert({
    where:  { userId: session.user.id },
    create: {
      userId:       session.user.id,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    },
    update: {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    },
  })

  const response = NextResponse.redirect(
    new URL(`${APP_URL}/tools/bc-reports?bc_connected=1`)
  )
  response.cookies.delete("bc_oauth_state")
  return response
}
