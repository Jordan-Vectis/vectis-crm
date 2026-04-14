import { redirect } from "next/navigation"
import Link from "next/link"
import { getCustomerSession } from "@/lib/customer-auth"

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex flex-col sm:flex-row gap-8">

        {/* Sidebar */}
        <aside className="sm:w-56 shrink-0">
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
              My Account
            </p>
            <p className="font-semibold text-gray-900 mb-5 text-sm">
              {session.firstName} {session.lastName}
            </p>
            <nav className="space-y-1 text-sm">
              <SideLink href="/account" label="My Details" />
              <SideLink href="/account/sales" label="My Sales" />
              <SideLink href="/account/bids" label="My Bids" />
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}

function SideLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-[#1e3058] transition-colors font-medium"
    >
      {label}
    </Link>
  )
}
