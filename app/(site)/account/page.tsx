"use client"

import { useActionState } from "react"
import { updateCustomerDetails } from "@/lib/actions/customer-auth"

export default function MyAccountPage() {
  const [state, action, pending] = useActionState(updateCustomerDetails, null)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Details</h1>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm max-w-lg">
        {"error" in (state ?? {}) && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {(state as { error: string }).error}
          </div>
        )}
        {"success" in (state ?? {}) && (
          <div className="mb-5 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
            {(state as { success: string }).success}
          </div>
        )}

        <form action={action} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input
                name="firstName"
                type="text"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input
                name="lastName"
                type="text"
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-3">Change Password</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current password</label>
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
                />
                <p className="text-xs text-gray-400 mt-1">Leave blank to keep current password</p>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="bg-[#1e3058] hover:bg-[#162544] disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            {pending ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </div>
    </div>
  )
}
