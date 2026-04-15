"use client"

import Link from "next/link"
import { useActionState, useState } from "react"
import { registerCustomer } from "@/lib/actions/customer-auth"

function Field({
  label, name, type = "text", required, autoComplete, placeholder, hint,
}: {
  label: string; name: string; type?: string
  required?: boolean; autoComplete?: string; placeholder?: string; hint?: string
}) {
  return (
    <div>
      <label className="block text-xs font-bold tracking-wider text-gray-600 uppercase mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#32348A] transition-colors"
      />
      {hint && <p className="text-[10px] text-gray-400 mt-1 tracking-wide">{hint}</p>}
    </div>
  )
}

export default function CustomerRegisterPage() {
  const [state, action, pending] = useActionState(registerCustomer, null)
  const [billingSame, setBillingSame] = useState(true)

  return (
    <div className="bg-gray-50 px-4 py-12">
      <div className="w-full max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-[#32348A] tracking-tight mb-1">REGISTER</h1>
          <p className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Create your Vectis account to bid &amp; track sales</p>
        </div>

        {state?.error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-sm text-red-700">
            {state.error}
          </div>
        )}

        <form action={action} className="space-y-6">

          {/* ── Personal details ── */}
          <div className="bg-white border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wider text-[#32348A] mb-4">Personal Details</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name" name="firstName" required autoComplete="given-name" />
                <Field label="Last Name"  name="lastName"  required autoComplete="family-name" />
              </div>
              <Field label="Email Address" name="email" type="email" required autoComplete="email" />
              <Field label="Phone Number" name="phone" type="tel" autoComplete="tel" placeholder="Optional" />
              <Field label="Password" name="password" type="password" required autoComplete="new-password" hint="Minimum 8 characters" />
            </div>
          </div>

          {/* ── Shipping address ── */}
          <div className="bg-white border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wider text-[#32348A] mb-4">Shipping Address</h2>
            <div className="space-y-4">
              <Field label="Address Line 1" name="shippingLine1" autoComplete="shipping address-line1" placeholder="Optional" />
              <Field label="Address Line 2" name="shippingLine2" autoComplete="shipping address-line2" placeholder="Optional" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="City / Town"  name="shippingCity"   autoComplete="shipping address-level2" />
                <Field label="County"       name="shippingCounty" placeholder="Optional" />
              </div>
              <Field label="Postcode" name="shippingPostcode" autoComplete="shipping postal-code" />

              <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-gray-100">
                <input
                  type="checkbox"
                  name="billingSameAsShipping"
                  checked={billingSame}
                  onChange={e => setBillingSame(e.target.checked)}
                  className="w-4 h-4 accent-[#32348A]"
                />
                <span className="text-sm font-medium text-gray-700">Billing address same as shipping</span>
              </label>
            </div>
          </div>

          {/* ── Billing address ── */}
          {!billingSame && (
            <div className="bg-white border border-gray-200 p-6 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#32348A] mb-4">Billing Address</h2>
              <div className="space-y-4">
                <Field label="Address Line 1" name="billingLine1" autoComplete="billing address-line1" />
                <Field label="Address Line 2" name="billingLine2" autoComplete="billing address-line2" placeholder="Optional" />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City / Town" name="billingCity"   autoComplete="billing address-level2" />
                  <Field label="County"      name="billingCounty" placeholder="Optional" />
                </div>
                <Field label="Postcode" name="billingPostcode" autoComplete="billing postal-code" />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-[#32348A] hover:bg-[#28296e] disabled:opacity-50 text-white font-bold py-3 text-xs tracking-widest uppercase transition-colors"
          >
            {pending ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Already have an account?</p>
          <Link
            href="/portal/login"
            className="inline-block border border-[#32348A] text-[#32348A] font-bold text-xs px-6 py-2.5 tracking-widest uppercase hover:bg-[#32348A] hover:text-white transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
