import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { authConfig } from "@/auth.config"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      role: string
      departmentId: string | null
      appPermissions: Record<string, { role: string }> | null
    }
  }
  interface User {
    role: string
    departmentId: string | null
    appPermissions: Record<string, { role: string }> | null
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null

        const input = (credentials.email as string).trim()
        const isEmail = input.includes("@")
        const user = await prisma.user.findFirst({
          where: isEmail
            ? { email: { equals: input, mode: "insensitive" } }
            : { username: { equals: input, mode: "insensitive" } },
        })

        if (!user) return null

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )
        if (!valid) return null

        const SUPERADMIN_EMAILS = ["it@vectis.co.uk"]
        const effectiveRole = SUPERADMIN_EMAILS.includes(user.email.toLowerCase()) ? "ADMIN" : user.role

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: effectiveRole,
          departmentId: user.departmentId,
          appPermissions: user.appPermissions as Record<string, { role: string }> | null,
        }
      },
    }),
  ],
})
