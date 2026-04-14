"use client"

import Link from "next/link"
import { useActionState } from "react"
import { registerCustomer } from "@/lib/actions/customer-auth"

export default function CustomerRegisterPage() {
  const [state, action, pending] = useActionState(registerCustomer, null)

  return (
    <div className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-[#1e3058] tracking-tight mb-1">REGISTER</h1>
          <p className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Create your Vectis account to bid &amp; track sales</p>
        </div>

        <div className="bg-white border border-gray-200 p-8 shadow-sm">
          {state?.error && (
            <div className="mb-5 p-3 bg-red-50 border border-red-200 text-sm text-red-700">
              {state.error}
            </div>
          )}

          <form action={action} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold tracking-wider text-gray-600 uppercase mb-1.5">
                  First Name
                </label>
                <input
                  name="firstName"
                  type="text"
                  required
                  autoComplete="given-name"
                  className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#1e3058] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-bold tracking-wider text-gray-600 uppercase mb-1.5">
                  Last Name
                </label>
                <input
                  name="lastName"
                  type="text"
                  required
                  autoComplete="family-name"
                  className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#1e3058] transition-colors"
                />
              </div>
            </div>

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
                autoComplete="new-password"
                minLength={8}
                className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#1e3058] transition-colors"
              />
              <p className="text-[10px] text-gray-400 mt-1 tracking-wide">Minimum 8 characters</p>
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full bg-[#1e3058] hover:bg-[#162544] disabled:opacity-50 text-white font-bold py-3 text-xs tracking-widest uppercase transition-colors mt-2"
            >
              {pending ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Already have an account?</p>
            <Link
              href="/portal/login"
              className="inline-block border border-[#1e3058] text-[#1e3058] font-bold text-xs px-6 py-2.5 tracking-widest uppercase hover:bg-[#1e3058] hover:text-white transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
