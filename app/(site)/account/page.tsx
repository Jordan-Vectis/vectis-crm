import { redirect } from "next/navigation"
import { getCustomerSession } from "@/lib/customer-auth"
import DetailsForm from "./details-form"

export const metadata = { title: "My Details — Vectis" }

export default async function MyAccountPage() {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Details</h1>
      <DetailsForm account={session} />
    </div>
  )
}
