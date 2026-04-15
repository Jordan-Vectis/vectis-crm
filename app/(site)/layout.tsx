import SiteNav from "@/components/site-nav"
import type { Metadata } from "next"

export const metadata: Metadata = {
  metadataBase: new URL("https://www.vectis.co.uk"),
  title: {
    default: "Vectis Auctions — World's No.1 Diecast Specialist",
    template: "%s — Vectis Auctions",
  },
  description:
    "Vectis Auctions is the world's leading specialist auction house for diecast, tinplate and collectable toys. Browse catalogues, bid live, and sell your collection.",
  keywords: [
    "diecast auctions", "toy auctions", "Vectis", "collectable toys",
    "Matchbox", "Corgi", "Dinky", "diecast specialist", "online bidding",
  ],
  openGraph: {
    siteName: "Vectis Auctions",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    site: "@VectisAuctions",
  },
  robots: { index: true, follow: true },
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SiteNav />
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="bg-[#1e3058] text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
            <div>
              <h4 className="text-xs font-bold tracking-[0.2em] uppercase mb-4 text-[#2AB4A6]">Auction Calendar</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/auctions" className="hover:text-white transition-colors">Upcoming Auctions</a></li>
                <li><a href="/auctions?tab=past" className="hover:text-white transition-colors">Past Auctions</a></li>
                <li><a href="/auctions?tab=past" className="hover:text-white transition-colors">Auction Results</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-[0.2em] uppercase mb-4 text-[#2AB4A6]">Bidding</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/portal/register" className="hover:text-white transition-colors">Register to Bid</a></li>
                <li><a href="/portal/login" className="hover:text-white transition-colors">Online Bidding</a></li>
                <li><a href="/auctions" className="hover:text-white transition-colors">How to Bid</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-[0.2em] uppercase mb-4 text-[#2AB4A6]">Selling</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/submit" className="hover:text-white transition-colors">Sell With Us</a></li>
                <li><a href="/submit" className="hover:text-white transition-colors">Free Valuation</a></li>
                <li><a href="/account/sales" className="hover:text-white transition-colors">My Consignments</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-[0.2em] uppercase mb-4 text-[#2AB4A6]">My Account</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/account" className="hover:text-white transition-colors">My Details</a></li>
                <li><a href="/account/bids" className="hover:text-white transition-colors">My Bids</a></li>
                <li><a href="/account/sales" className="hover:text-white transition-colors">My Sales</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
            <div className="flex flex-col items-center sm:items-start gap-1">
              <span className="text-white font-black tracking-tight text-lg">Vectis</span>
              <span className="tracking-[0.2em] text-gray-400 text-[10px] uppercase">Collectables Specialists</span>
            </div>
            <span>&copy; {new Date().getFullYear()} Vectis Auctions Ltd. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
