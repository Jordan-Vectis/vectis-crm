"use client"

import { useState } from "react"
import Link from "next/link"

interface Props {
  auctionDates: string[]   // ISO date strings of published auctions
  auctionTypes: string[]
  selectedType: string
}

const DAYS   = ["Su","Mo","Tu","We","Th","Fr","Sa"]
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"]

export default function AuctionCalendarSidebar({ auctionDates, auctionTypes, selectedType }: Props) {
  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const auctionDateSet = new Set(
    auctionDates.map(d => {
      const dt = new Date(d)
      return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`
    })
  )

  const firstDay   = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const isToday = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  const hasAuction = (d: number) => auctionDateSet.has(`${year}-${month}-${d}`)

  return (
    <aside className="w-60 shrink-0">

      {/* Calendar */}
      <div className="bg-white border border-gray-200 rounded mb-4">
        {/* Month nav */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
          <button onClick={prevMonth} className="text-gray-400 hover:text-[#32348A] transition-colors p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[#32348A] font-bold text-sm uppercase tracking-wide">
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} className="text-gray-400 hover:text-[#32348A] transition-colors p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 px-2 pt-2">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 px-2 pb-3 gap-y-0.5">
          {cells.map((d, i) => {
            if (!d) return <div key={`e-${i}`} />
            const auction = hasAuction(d)
            const today   = isToday(d)
            return (
              <div
                key={d}
                className={`relative flex items-center justify-center rounded-full w-7 h-7 mx-auto text-xs font-medium cursor-default transition-colors ${
                  auction
                    ? "bg-[#32348A] text-white font-bold cursor-pointer"
                    : today
                    ? "bg-[#2AB4A6]/20 text-[#32348A] font-bold"
                    : "text-gray-600"
                }`}
              >
                {d}
                {auction && (
                  <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#2AB4A6]" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Category filter */}
      {auctionTypes.length > 0 && (
        <div className="bg-white border border-gray-200 rounded">
          <div className="px-3 py-2.5 border-b border-gray-100">
            <span className="text-[#32348A] font-bold text-xs uppercase tracking-wide">Categories</span>
          </div>
          <div className="py-1">
            <Link
              href="/auctions"
              className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                !selectedType ? "text-[#32348A] font-bold" : "text-gray-600 hover:text-[#32348A]"
              }`}
            >
              <span className={`w-3 h-3 rounded-full border-2 border-[#32348A] ${!selectedType ? "bg-[#32348A]" : ""}`} />
              All Auctions
            </Link>
            {auctionTypes.map(t => (
              <Link
                key={t}
                href={`/auctions?type=${encodeURIComponent(t)}`}
                className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  selectedType === t ? "text-[#32348A] font-bold" : "text-gray-600 hover:text-[#32348A]"
                }`}
              >
                <span className={`w-3 h-3 rounded-full border-2 border-[#32348A] ${selectedType === t ? "bg-[#32348A]" : ""}`} />
                {t}
              </Link>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
