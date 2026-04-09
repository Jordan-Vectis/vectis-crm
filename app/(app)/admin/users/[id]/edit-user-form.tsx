"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateUser } from "@/lib/actions/admin"
import { ALL_APPS } from "@/lib/apps"
import type { AppKey } from "@/lib/apps"

interface Props {
  userId: string
  name: string
  role: string
  departmentId: string | null
  allowedApps: string[]
  departments: { id: string; name: string }[]
  isSelf: boolean
}

export default function EditUserForm({ userId, name, role, departmentId, allowedApps, departments, isSelf }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedApps, setSelectedApps] = useState<string[]>(allowedApps)
  const [appsPending, startAppsTransition] = useTransition()
  const [appsMsg, setAppsMsg] = useState<string | null>(null)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm]   = useState("")
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdPending, startPwdTransition] = useTransition()

  function toggleApp(key: AppKey) {
    setSelectedApps(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function saveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await updateUser(userId, fd)
      router.refresh()
    })
  }

  function saveApps() {
    setAppsMsg(null)
    startAppsTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/apps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedApps: selectedApps }),
      })
      setAppsMsg(res.ok ? "Saved" : "Failed to save")
      if (res.ok) setTimeout(() => setAppsMsg(null), 2000)
    })
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setPwdError("Passwords do not match."); return }
    if (password.length < 8)  { setPwdError("Password must be at least 8 characters."); return }
    setPwdError(null)
    const fd = new FormData()
    fd.set("name", name)
    fd.set("password", password)
    startPwdTransition(async () => {
      await updateUser(userId, fd)
      setPwdOpen(false)
      setPassword("")
      setConfirm("")
    })
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Basic details ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Basic Details</h2>
        <form onSubmit={saveDetails} className="flex flex-col gap-4 max-w-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input name="name" defaultValue={name} required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select name="role" defaultValue={role} disabled={isSelf}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400">
              <option value="ADMIN">Admin</option>
              <option value="COLLECTIONS">Collections</option>
              <option value="CATALOGUER">Cataloguer</option>
            </select>
            {isSelf && <p className="text-xs text-gray-400 mt-1">You cannot change your own role.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select name="departmentId" defaultValue={departmentId ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">None</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={isPending}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
            {isPending ? "Saving…" : "Save Details"}
          </button>
        </form>
      </section>

      {/* ── App access ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-1">App Access</h2>
        <p className="text-sm text-gray-500 mb-4">Choose which apps this user can see and access.</p>
        {role === "ADMIN" ? (
          <p className="text-sm text-gray-500 italic">Admin users have access to all apps.</p>
        ) : (
          <>
            <div className="flex flex-col gap-3 mb-5">
              {ALL_APPS.map(app => (
                <label key={app.key} className="flex items-center gap-3 cursor-pointer group">
                  <div onClick={() => toggleApp(app.key)}
                    className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                      selectedApps.includes(app.key) ? "bg-blue-600 border-blue-600" : "border-gray-300 group-hover:border-blue-400"
                    }`}>
                    {selectedApps.includes(app.key) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{app.label}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={saveApps} disabled={appsPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {appsPending ? "Saving…" : "Save App Access"}
              </button>
              {appsMsg && <span className={`text-sm ${appsMsg === "Saved" ? "text-green-600" : "text-red-500"}`}>{appsMsg}</span>}
            </div>
          </>
        )}
      </section>

      {/* ── Password ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Password</h2>
        <p className="text-sm text-gray-500 mb-4">Reset this user's password.</p>
        {!pwdOpen ? (
          <button onClick={() => setPwdOpen(true)}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:border-gray-400 transition-colors">
            Change Password
          </button>
        ) : (
          <form onSubmit={savePassword} className="flex flex-col gap-3 max-w-sm">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="New password" minLength={8} required
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm password" required
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {pwdError && <p className="text-xs text-red-500">{pwdError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={pwdPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {pwdPending ? "Saving…" : "Update Password"}
              </button>
              <button type="button" onClick={() => { setPwdOpen(false); setPwdError(null) }}
                className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:border-gray-400 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

    </div>
  )
}
