"use client"

import { useActionState, useState } from "react"
import { updateCustomerDetails } from "@/lib/actions/customer-auth"
import type { CustomerSession } from "@/lib/customer-auth"

function Field({
  label, name, type = "text", defaultValue, autoComplete, placeholder,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string | null
  autoComplete?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-bold tracking-wider text-gray-600 uppercase mb-1.5">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#1e3058] transition-colors rounded"
      />
    </div>
  )
}

function AddressBlock({
  prefix, legend, defaults,
}: {
  prefix: string
  legend: string
  defaults: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    county?: string | null
    postcode?: string | null
  }
}) {
  return (
    <div>
      <p className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">{legend}</p>
      <div className="space-y-3">
        <Field label="Address Line 1" name={`${prefix}Line1`} defaultValue={defaults.line1} autoComplete={`${prefix === "shipping" ? "shipping" : "billing"} address-line1`} />
        <Field label="Address Line 2" name={`${prefix}Line2`} defaultValue={defaults.line2} autoComplete={`${prefix === "shipping" ? "shipping" : "billing"} address-line2`} placeholder="Optional" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="City / Town" name={`${prefix}City`} defaultValue={defaults.city} autoComplete={`${prefix === "shipping" ? "shipping" : "billing"} address-level2`} />
          <Field label="County" name={`${prefix}County`} defaultValue={defaults.county} placeholder="Optional" />
        </div>
        <Field label="Postcode" name={`${prefix}Postcode`} defaultValue={defaults.postcode} autoComplete={`${prefix === "shipping" ? "shipping" : "billing"} postal-code`} />
      </div>
    </div>
  )
}

export default function DetailsForm({ account }: { account: CustomerSession }) {
  const [state, action, pending] = useActionState(updateCustomerDetails, null)
  const [billingSame, setBillingSame] = useState(account.billingSameAsShipping)

  return (
    <form action={action} className="space-y-6">
      {/* Status messages */}
      {"error" in (state ?? {}) && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {(state as { error: string }).error}
        </div>
      )}
      {"success" in (state ?? {}) && (
        <div className="p-3 rounded bg-green-50 border border-green-200 text-sm text-green-700">
          {(state as { success: string }).success}
        </div>
      )}

      {/* ── Personal details ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-gray-800 mb-4">Personal Details</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First Name" name="firstName" defaultValue={account.firstName} autoComplete="given-name" />
          <Field label="Last Name"  name="lastName"  defaultValue={account.lastName}  autoComplete="family-name" />
        </div>
        <Field label="Phone Number" name="phone" type="tel" defaultValue={account.phone} autoComplete="tel" placeholder="Optional" />
        <div>
          <label className="block text-xs font-bold tracking-wider text-gray-600 uppercase mb-1.5">Email Address</label>
          <input
            type="email"
            value={account.email}
            disabled
            className="w-full border border-gray-200 bg-gray-50 text-gray-500 px-3 py-2.5 text-sm rounded cursor-not-allowed"
          />
          <p className="text-[10px] text-gray-400 mt-1">Email cannot be changed. Contact us if you need to update it.</p>
        </div>
      </div>

      {/* ── Shipping address ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-gray-800 mb-1">Shipping Address</h2>
        <AddressBlock prefix="shipping" legend="" defaults={{
          line1: account.shippingLine1,
          line2: account.shippingLine2,
          city: account.shippingCity,
          county: account.shippingCounty,
          postcode: account.shippingPostcode,
        }} />

        <label className="flex items-center gap-2 cursor-pointer mt-2 pt-3 border-t border-gray-100">
          <input
            type="checkbox"
            name="billingSameAsShipping"
            checked={billingSame}
            onChange={e => setBillingSame(e.target.checked)}
            className="w-4 h-4 accent-[#1e3058]"
          />
          <span className="text-sm font-medium text-gray-700">Billing address same as shipping</span>
        </label>
      </div>

      {/* ── Billing address (only when different) ── */}
      {!billingSame && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-gray-800 mb-1">Billing Address</h2>
          <AddressBlock prefix="billing" legend="" defaults={{
            line1: account.billingLine1,
            line2: account.billingLine2,
            city: account.billingCity,
            county: account.billingCounty,
            postcode: account.billingPostcode,
          }} />
        </div>
      )}

      {/* ── Change password ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-gray-800 mb-1">Change Password</h2>
        <Field label="Current Password" name="currentPassword" type="password" autoComplete="current-password" placeholder="Enter current password to change it" />
        <Field label="New Password" name="newPassword" type="password" autoComplete="new-password" placeholder="Leave blank to keep current password" />
        <p className="text-xs text-gray-400">Minimum 8 characters</p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-[#1e3058] hover:bg-[#162544] disabled:opacity-50 text-white font-bold px-8 py-3 text-xs tracking-widest uppercase transition-colors"
      >
        {pending ? "Saving…" : "Save Changes"}
      </button>
    </form>
  )
}
