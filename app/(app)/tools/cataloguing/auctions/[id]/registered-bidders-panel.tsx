"use client"

import { useState } from "react"
import { format } from "date-fns"

interface Registration {
  id: string
  contactId: string | null
  registeredAt: string
  customer: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
  }
}

interface Props {
  auctionId: string
  auctionName: string
  registrations: Registration[]
}

export default function RegisteredBiddersPanel({ auctionName, registrations }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* ── Sticky banner at the top ── */}
      <div
        className="bg-[#1e3058] border-b border-white/10 px-6 py-3 flex items-center justify-between cursor-pointer hover:bg-[#162544] transition-colors select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#2AB4A6] flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <span className="text-white font-black text-sm uppercase tracking-wider">Registered Bidders</span>
            <span className="ml-3 bg-[#2AB4A6] text-white text-xs font-black px-2 py-0.5 rounded-full">
              {registrations.length}
            </span>
          </div>
          <span className="text-gray-400 text-xs ml-2 hidden sm:block">{auctionName}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-300 text-xs">
          <span>{open ? "Hide" : "View all"}</span>
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* ── Expanded table ── */}
      {open && (
        <div className="bg-[#111827] border-b border-white/10">
          {registrations.length === 0 ? (
            <div className="py-10 text-center text-gray-500 text-sm">
              No bidders registered for this auction yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">C Number</th>
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Name</th>
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Email</th>
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Phone</th>
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors ${i % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"}`}
                    >
                      <td className="px-5 py-3">
                        <span className="font-black text-[#2AB4A6] text-xs tracking-wider">
                          {r.contactId ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-white font-medium">
                        {r.customer.firstName} {r.customer.lastName}
                      </td>
                      <td className="px-5 py-3 text-gray-300">
                        <a href={`mailto:${r.customer.email}`} className="hover:text-[#2AB4A6] transition-colors">
                          {r.customer.email}
                        </a>
                      </td>
                      <td className="px-5 py-3 text-gray-400">
                        {r.customer.phone ?? <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {format(new Date(r.registeredAt), "dd MMM yyyy HH:mm")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between">
                <p className="text-gray-500 text-xs">{registrations.length} bidder{registrations.length !== 1 ? "s" : ""} registered</p>
                <button
                  onClick={() => {
                    // CSV export
                    const rows = [
                      ["C Number", "First Name", "Last Name", "Email", "Phone", "Registered At"],
                      ...registrations.map(r => [
                        r.contactId ?? "",
                        r.customer.firstName,
                        r.customer.lastName,
                        r.customer.email,
                        r.customer.phone ?? "",
                        format(new Date(r.registeredAt), "dd/MM/yyyy HH:mm"),
                      ]),
                    ]
                    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")
                    const blob = new Blob([csv], { type: "text/csv" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = `registered-bidders.csv`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="text-xs text-gray-400 hover:text-white border border-white/20 hover:border-white/40 px-3 py-1.5 transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export CSV
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
