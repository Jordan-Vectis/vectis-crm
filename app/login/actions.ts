"use server"

import { AuthError } from "next-auth"
import { signIn } from "@/auth"

export async function loginAction(
  _prevState: string | null,
  formData: FormData
): Promise<string | null> {
  try {
    await signIn("credentials", {
      email:      formData.get("email"),
      password:   formData.get("password"),
      redirectTo: "/hub",
    })
  } catch (error) {
    // NEXT_REDIRECT is thrown by Next.js to perform the redirect — re-throw it
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error
    if ((error as any)?.digest?.startsWith("NEXT_REDIRECT")) throw error

    if (error instanceof AuthError) {
      return "Invalid email, username, or password."
    }
    return "Something went wrong. Please try again."
  }
  return null
}
