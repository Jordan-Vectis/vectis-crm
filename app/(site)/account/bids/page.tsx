import { getCustomerSession } from "@/lib/customer-auth"
import { redirect } from "next/navigation"
import Link from "next/link"

export const metadata = { title: "My Bids — Vectis" }

export default async function MyBidsPage() {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">My Bids</h1>
      <p className="text-sm text-gray-500 mb-8">Your bidding history and active bids.</p>

      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
        <div className="text-5xl mb-4">🔨</div>
        <p className="text-gray-700 font-semibold text-lg mb-2">Online bidding coming soon</p>
        <p className="text-sm text-gray-400 max-w-md mx-auto">
          Online and live bidding will be available shortly. In the meantime, contact us to place commission bids.
        </p>
        <div className="mt-6">
          <Link
            href="/auctions"
            className="inline-block bg-[#1e3058] text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-[#162544] transition-colors"
          >
            Browse current auctions
          </Link>
        </div>
      </div>
    </div>
  )
}
