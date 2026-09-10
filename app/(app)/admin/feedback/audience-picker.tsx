"use client"

import { useMemo, useState } from "react"
import { TickBox, audienceIncludes, roleLabel } from "./feedback-shared"

// "Who gets it" — whole roles and/or named people, with the number of people it reaches worked
// out live from the user list as boxes are ticked (Jordan picks the audience per survey).
//
// ⚠ The count uses audienceIncludes(), the same rule as the popup side's inAudience(), so the
// number here is the number of people who actually get the popup.

export type AudienceUser = { id: string; name: string; role: string }
export type AudienceRole = { role: string; count: number }

export default function AudiencePicker({
  roles, users, selectedRoles, selectedUserIds, onRoles, onUsers,
}: {
  roles: AudienceRole[]
  users: AudienceUser[]
  selectedRoles: string[]
  selectedUserIds: string[]
  onRoles: (roles: string[]) => void
  onUsers: (ids: string[]) => void
}) {
  const [search, setSearch] = useState("")
  const [onlyTicked, setOnlyTicked] = useState(false)

  const audience = { audienceRoles: selectedRoles, audienceUserIds: selectedUserIds }
  const reached = users.filter(u => audienceIncludes(audience, u))
  const byRole = users.filter(u => selectedRoles.includes(u.role)).length
  const namedOnly = users.filter(u => selectedUserIds.includes(u.id) && !selectedRoles.includes(u.role)).length

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (onlyTicked && !selectedUserIds.includes(u.id)) return false
      if (!q) return true
      return u.name.toLowerCase().includes(q) || roleLabel(u.role).toLowerCase().includes(q)
    })
  }, [users, search, onlyTicked, selectedUserIds])

  const toggleRole = (role: string) =>
    onRoles(selectedRoles.includes(role) ? selectedRoles.filter(r => r !== role) : [...selectedRoles, role])
  const toggleUser = (id: string) =>
    onUsers(selectedUserIds.includes(id) ? selectedUserIds.filter(u => u !== id) : [...selectedUserIds, id])

  const input = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500"

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 md:p-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Who gets it</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Tick whole roles, named people, or both. Someone ticked twice still only gets it once.
      </p>

      {/* The answer first — the number is what matters. */}
      <div
        className={`mt-4 rounded-xl border px-4 py-3 ${
          reached.length > 0
            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/40"
            : "border-amber-300 bg-amber-50 dark:border-amber-600/60 dark:bg-amber-950/40"
        }`}
        aria-live="polite"
      >
        <p className={`text-xl font-bold ${reached.length > 0 ? "text-emerald-900 dark:text-emerald-100" : "text-amber-900 dark:text-amber-100"}`}>
          {reached.length > 0
            ? `${reached.length} ${reached.length === 1 ? "person" : "people"} will get this`
            : "Nobody will get this yet"}
        </p>
        <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
          {reached.length > 0
            ? [byRole ? `${byRole} through their role` : "", namedOnly ? `${namedOnly} named on their own` : ""].filter(Boolean).join(" · ")
            : "Tick at least one role or person below."}
        </p>
        {reached.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-emerald-800 dark:text-emerald-300">Show who</summary>
            <p className="pb-1 text-gray-700 dark:text-gray-300">{reached.map(u => u.name).join(", ")}</p>
          </details>
        )}
      </div>

      <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Roles</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {roles.map(r => (
          <TickBox key={r.role} ticked={selectedRoles.includes(r.role)} onToggle={() => toggleRole(r.role)}>
            <span className="block font-medium text-gray-900 dark:text-gray-100">{roleLabel(r.role)}</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {r.count === 0 ? "nobody has this role at the moment" : `${r.count} ${r.count === 1 ? "person" : "people"}`}
            </span>
          </TickBox>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Named people {selectedUserIds.length > 0 && <span className="normal-case tracking-normal">· {selectedUserIds.length} ticked</span>}
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOnlyTicked(v => !v)}
            className={`min-h-11 rounded-xl border px-3 text-sm font-medium ${
              onlyTicked
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            }`}
          >
            {onlyTicked ? "Showing ticked only" : "Show ticked only"}
          </button>
          {selectedUserIds.length > 0 && (
            <button
              type="button"
              onClick={() => onUsers([])}
              className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Untick all named people
            </button>
          )}
        </div>
      </div>
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name or role…"
        className={`${input} mt-2`}
        aria-label="Search people"
      />
      <div className="mt-2 max-h-[28rem] space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 p-1 dark:border-gray-800">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
            {onlyTicked && !search.trim() ? "Nobody is ticked by name." : "Nobody matches that search."}
          </p>
        ) : (
          shown.map(u => {
            const viaRole = selectedRoles.includes(u.role)
            return (
              <TickBox key={u.id} ticked={selectedUserIds.includes(u.id)} onToggle={() => toggleUser(u.id)}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{u.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{roleLabel(u.role)}</span>
                  {viaRole && (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400">already gets it through their role</span>
                  )}
                </span>
              </TickBox>
            )
          })
        )}
      </div>
    </section>
  )
}
