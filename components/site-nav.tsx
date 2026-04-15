import Link from "next/link"
import { getCustomerSession } from "@/lib/customer-auth"
import { logoutCustomer } from "@/lib/actions/customer-auth"

export default async function SiteNav() {
  const session = await getCustomerSession()

  return (
    <header>
      {/* ── Top tier: search / logo / account ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between gap-4">

          {/* Search */}
          <form method="GET" action="/auctions" className="flex items-center gap-0 border border-gray-300 rounded overflow-hidden w-64 shrink-0">
            <span className="px-3 text-gray-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </span>
            <input
              name="search"
              placeholder="SEARCH"
              className="flex-1 py-2 text-sm text-gray-700 placeholder:text-gray-400 placeholder:font-semibold placeholder:tracking-wider focus:outline-none"
            />
            <select name="filter" className="border-l border-gray-300 px-2 py-2 text-xs text-gray-600 bg-gray-50 focus:outline-none">
              <option>Upcoming</option>
              <option>Past</option>
              <option>All</option>
            </select>
            <button type="submit" className="bg-[#1e3058] text-white text-xs font-bold px-3 py-2 tracking-wider hover:bg-[#162544] transition-colors">
              GO
            </button>
          </form>

          {/* Logo */}
          <Link href="/" className="flex flex-col items-center">
            <span className="text-3xl font-black tracking-tight text-[#1e3058] leading-none">Vectis</span>
            <span className="text-[9px] font-semibold tracking-[0.25em] text-gray-500 uppercase mt-0.5">Collectables Specialists</span>
          </Link>

          {/* Account */}
          <div className="flex items-center gap-3 shrink-0">
            {session ? (
              <>
                <form action={logoutCustomer}>
                  <button type="submit" className="border border-[#1e3058] text-[#1e3058] text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#1e3058] hover:text-white transition-colors">
                    LOG OUT
                  </button>
                </form>
                <Link href="/account" className="bg-[#1e3058] text-white text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#162544] transition-colors flex items-center gap-2">
                  MY ACCOUNT
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                  </svg>
                </Link>
              </>
            ) : (
              <>
                <Link href="/portal/login" className="border border-[#1e3058] text-[#1e3058] text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#1e3058] hover:text-white transition-colors">
                  LOG IN
                </Link>
                <Link href="/portal/register" className="bg-[#1e3058] text-white text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#162544] transition-colors flex items-center gap-2">
                  MY ACCOUNT
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                  </svg>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom tier: nav links ── */}
      <nav className="bg-[#1e3058]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <ul className="flex items-center gap-0 text-xs font-semibold tracking-wider text-white">
            <NavItem href="/" label="HOME" />
            <NavItem href="/auctions" label="AUCTION CALENDAR" hasArrow />
            <NavItem href="/auctions" label="DEPARTMENTS" hasArrow />
            <NavItem href="/portal/register" label="HOW TO BID" />
            <NavItem href="/submit" label="SELL WITH US" />
            <NavItem href="/auctions" label="NEWS &amp; STORIES" hasArrow />
            <NavItem href="/auctions" label="CAREERS" />
            <NavItem href="/auctions" label="CONTACT US" />
          </ul>
        </div>
      </nav>
    </header>
  )
}

function NavItem({ href, label, hasArrow }: { href: string; label: string; hasArrow?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-1 px-4 py-3 hover:bg-white/10 transition-colors whitespace-nowrap"
      >
        {label}
        {hasArrow && (
          <svg className="w-2.5 h-2.5 opacity-70" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </Link>
    </li>
  )
}
