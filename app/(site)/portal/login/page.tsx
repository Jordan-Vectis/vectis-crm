"use client"

import Link from "next/link"
import { useActionState } from "react"
import { loginCustomer } from "@/lib/actions/customer-auth"

export default function CustomerLoginPage() {
  const [state, action, pending] = useActionState(loginCustomer, null)

  return (
    <div className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-[#1e3058] tracking-tight mb-1">MY ACCOUNT</h1>
          <p className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Sign in to your Vectis account</p>
        </div>

        <div className="bg-white border border-gray-200 p-8 shadow-sm">
          {state?.error && (
            <div className="mb-5 p-3 bg-red-50 border border-red-200 text-sm text-red-700">
              {state.error}
            </div>
          )}

          <form action={action} className="space-y-4">
            <div>
              <label className="block text-xs font-bold tracking-wider text-gray-600 uppercase mb-1.5">
                Email Address
              </label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#1e3058] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-bold tracking-wider text-gray-600 uppercase mb-1.5">
                Password
              </label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#1e3058] transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full bg-[#1e3058] hover:bg-[#162544] disabled:opacity-50 text-white font-bold py-3 text-xs tracking-widest uppercase transition-colors mt-2"
            >
              {pending ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">New to Vectis?</p>
            <Link
              href="/portal/register"
              className="inline-block border border-[#1e3058] text-[#1e3058] font-bold text-xs px-6 py-2.5 tracking-widest uppercase hover:bg-[#1e3058] hover:text-white transition-colors"
            >
              Create an Account
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
