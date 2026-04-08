import type { NextAuthConfig } from "next-auth"

// Lightweight config used in proxy (Edge runtime — no Prisma/Node.js modules)
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const pathname = nextUrl.pathname

      const publicPaths = ["/login", "/setup"]
      if (publicPaths.some((p) => pathname.startsWith(p))) return true

      if (!isLoggedIn) return false
      if (isLoggedIn && pathname === "/login") {
        return Response.redirect(new URL("/submissions", nextUrl))
      }
      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.role = (user as { role: string }).role
        token.departmentId = (user as { departmentId: string | null }).departmentId
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as string
      session.user.departmentId = token.departmentId as string | null
      return session
    },
  },
  providers: [],
}
