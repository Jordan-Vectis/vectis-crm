import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "How to Bid",
  description: "Learn how to bid at Vectis Auctions — online, by commission, by telephone or in the saleroom.",
}

const increments = [
  { from: "£5",     to: "£50",     inc: "£5"    },
  { from: "£50",    to: "£200",    inc: "£10"   },
  { from: "£200",   to: "£700",    inc: "£20"   },
  { from: "£700",   to: "£1,000",  inc: "£50"   },
  { from: "£1,000", to: "£3,000",  inc: "£100"  },
  { from: "£3,000", to: "£7,000",  inc: "£200"  },
  { from: "£7,000", to: "£10,000", inc: "£500"  },
  { from: "£10,000",to: "above",   inc: "£1,000"},
]

export default function HowToBidPage() {
  return (
    <div className="bg-white">

      {/* Hero */}
      <div className="bg-[#1e1f5e] text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[#DB0606] text-xs font-black uppercase tracking-widest mb-3">Bidding Guide</p>
          <h1 className="text-4xl font-black mb-4">How to Bid</h1>
          <p className="text-white/70 text-lg max-w-2xl">
            There are several ways to bid at Vectis Auctions. Choose the method that suits you best.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-14 space-y-14">

        {/* Method 1 — Online */}
        <section>
          <div className="flex items-start gap-5">
            <div className="shrink-0 w-12 h-12 rounded-full bg-[#1e1f5e] flex items-center justify-center text-white font-black text-lg">1</div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 mb-3">Online Bidding</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                Create a free account on our website. Once registered, you can browse all upcoming auction catalogues,
                place commission bids in advance, and bid live when the auction is running. Your account lets you keep
                track of your bids, view your favourite items, see your purchased lots and track your parcels.
              </p>
              <Link
                href="/portal/register"
                className="inline-block bg-[#1e1f5e] hover:bg-[#28296e] text-white text-sm font-black uppercase tracking-widest px-6 py-3 transition-colors"
              >
                Create an Account
              </Link>
            </div>
          </div>
        </section>

        <hr className="border-gray-100" />

        {/* Method 2 — Commission / Advance */}
        <section>
          <div className="flex items-start gap-5">
            <div className="shrink-0 w-12 h-12 rounded-full bg-[#1e1f5e] flex items-center justify-center text-white font-black text-lg">2</div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 mb-3">Commission / Advance Bidding</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                Can&apos;t attend the live auction? Simply tell us the maximum you&apos;re willing to pay and we&apos;ll
                bid on your behalf up to that amount. Commission bids are executed at no charge and your maximum
                remains completely confidential.
              </p>
              <p className="text-gray-600 leading-relaxed mb-4">
                You can place commission bids directly through your account on any lot in an upcoming catalogue,
                or contact us by phone or email:
              </p>
              <div className="bg-gray-50 border border-gray-200 p-5 space-y-2 text-sm text-gray-700">
                <p><span className="font-bold">Phone:</span> +44 (0)1642 750 616</p>
                <p><span className="font-bold">Hours:</span> Monday – Friday, 9:00 am – 5:00 pm (UK time)</p>
                <p><span className="font-bold">Email:</span> admin@vectis.co.uk</p>
              </div>
              <p className="text-gray-500 text-sm mt-3">
                <strong>Reserve Policy:</strong> A reserve is set at 60% of the bottom estimate for all lots.
                If your bid does not meet this level you will need to bid again.
              </p>
            </div>
          </div>
        </section>

        <hr className="border-gray-100" />

        {/* Method 3 — Live Telephone */}
        <section>
          <div className="flex items-start gap-5">
            <div className="shrink-0 w-12 h-12 rounded-full bg-[#1e1f5e] flex items-center justify-center text-white font-black text-lg">3</div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 mb-3">Live Telephone Bidding</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                For lots valued over £100, you can arrange to bid live by telephone on auction day at no charge.
                One of our team will call you several minutes before your lot is offered for auction.
              </p>
              <div className="bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 mb-4">
                <strong>Please note:</strong> There is a £100 minimum for telephone bids. We cannot guarantee all
                telephone requests will be honoured due to high demand — please arrange this in advance.
              </div>
              <p className="text-gray-600 leading-relaxed">
                To arrange telephone bidding, contact us before the auction date on{" "}
                <a href="tel:+441642750616" className="text-[#1e1f5e] font-semibold hover:underline">+44 (0)1642 750 616</a>{" "}
                or email{" "}
                <a href="mailto:admin@vectis.co.uk" className="text-[#1e1f5e] font-semibold hover:underline">admin@vectis.co.uk</a>.
              </p>
            </div>
          </div>
        </section>

        <hr className="border-gray-100" />

        {/* Method 4 — Saleroom */}
        <section>
          <div className="flex items-start gap-5">
            <div className="shrink-0 w-12 h-12 rounded-full bg-[#1e1f5e] flex items-center justify-center text-white font-black text-lg">4</div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 mb-3">Saleroom / Live Online Bidding</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                Join the live auction online on the day via our website. Watch the live stream, see bids in real time,
                and place bids with a single click. You must be registered and approved to bid live before the sale begins.
              </p>
              <Link
                href="/auctions"
                className="inline-block border border-[#1e1f5e] text-[#1e1f5e] hover:bg-[#1e1f5e] hover:text-white text-sm font-black uppercase tracking-widest px-6 py-3 transition-colors"
              >
                Browse Upcoming Auctions
              </Link>
            </div>
          </div>
        </section>

        <hr className="border-gray-100" />

        {/* Buyer's Premium */}
        <section>
          <h2 className="text-2xl font-black text-gray-900 mb-4">Buyer&apos;s Premium</h2>
          <div className="bg-[#1e1f5e] text-white p-6">
            <p className="text-3xl font-black mb-1">27%</p>
            <p className="text-white/70 text-sm">22.5% + VAT on every winning lot (Vectis website)</p>
          </div>
          <p className="text-gray-500 text-sm mt-3">
            If bidding via The Saleroom platform, a combined premium of 32.94% applies (including VAT and Saleroom charges).
          </p>
        </section>

        <hr className="border-gray-100" />

        {/* Bidding Increments */}
        <section>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Bidding Increments</h2>
          <p className="text-gray-600 mb-6">Bids are accepted in the following increments. Non-standard amounts are rounded up to the nearest valid bid.</p>
          <div className="border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3 text-gray-500 font-bold text-xs uppercase tracking-wider">Bid Range</th>
                  <th className="text-right px-5 py-3 text-gray-500 font-bold text-xs uppercase tracking-wider">Increment</th>
                </tr>
              </thead>
              <tbody>
                {increments.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                    <td className="px-5 py-3 text-gray-700">{row.from} – {row.to}</td>
                    <td className="px-5 py-3 text-right font-bold text-[#1e1f5e]">{row.inc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-gray-50 border border-gray-200 p-8 text-center">
          <h3 className="text-xl font-black text-gray-900 mb-2">Ready to start bidding?</h3>
          <p className="text-gray-500 mb-6">Create your free account and browse thousands of lots across upcoming auctions.</p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/portal/register" className="bg-[#1e1f5e] hover:bg-[#28296e] text-white font-black text-sm uppercase tracking-widest px-8 py-3 transition-colors">
              Register Free
            </Link>
            <Link href="/auctions" className="border border-[#1e1f5e] text-[#1e1f5e] hover:bg-[#1e1f5e] hover:text-white font-black text-sm uppercase tracking-widest px-8 py-3 transition-colors">
              View Auctions
            </Link>
          </div>
        </section>

      </div>
    </div>
  )
}
