import { auth } from "@/auth"
import { redirect } from "next/navigation"
import StatusClient from "./status-client"

// 🚦 Status Centre — "staff say something's broken: is it us or a supplier?"
//
// The page itself is only the admin gate (same as /admin). Everything else is the
// client half, which reads /api/status in the browser rather than here on purpose:
// the database is one of the things this page checks, so a server-rendered page
// would hang or fail on exactly the day it is needed. The client shows "Loading…",
// then either the answer or a plain "couldn't reach the Hub's server" — which is
// itself the answer (it's us).
export const dynamic = "force-dynamic"
export const metadata = { title: "Status Centre" }

export default async function StatusCentrePage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")
  return <StatusClient />
}
