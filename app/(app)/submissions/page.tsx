import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SubmissionStatus } from "@/app/generated/prisma/enums"

const statusLabels: Record<SubmissionStatus, { label: string; color: string }> = {
  PENDING_ASSIGNMENT: { label: "Pending Assignment", color: "bg-gray-100 text-gray-700" },
  PENDING_VALUATION: { label: "Pending Valuation", color: "bg-yellow-100 text-yellow-700" },
  VALUATION_COMPLETE: { label: "Valuation Complete", color: "bg-blue-100 text-blue-700" },
  PENDING_CUSTOMER_DECISION: { label: "Awaiting Decision", color: "bg-purple-100 text-purple-700" },
  APPROVED: { label: "Approved", color: "bg-green-100 text-green-700" },
  DECLINED: { label: "Declined", color: "bg-red-100 text-red-700" },
  FOLLOW_UP: { label: "Follow-up", color: "bg-orange-100 text-orange-700" },
  COLLECTION_PENDING: { label: "Collection Pending", color: "bg-indigo-100 text-indigo-700" },
  ARRIVED: { label: "Arrived", color: "bg-teal-100 text-teal-700" },
  COMPLETED: { label: "Completed", color: "bg-emerald-100 text-emerald-700" },
}

const channelLabels: Record<string, string> = {
  EMAIL: "Email",
  WEB_FORM: "Web Form",
  PHONE: "Phone",
  WALK_IN: "Walk-in",
}

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>
}) {
  const session = await auth()
  const { status, search } = await searchParams

  const submissions = await prisma.submission.findMany({
    where: {
      ...(status ? { status: status as SubmissionStatus } : {}),
      ...(search
        ? {
            OR: [
              { customer: { name: { contains: search, mode: "insensitive" } } },
              { reference: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      customer: true,
      department: true,
      cataloguer: true,
      items: true,
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Submissions</h1>
          <p className="text-sm text-gray-500 mt-0.5">{submissions.length} total</p>
        </div>
        {(session?.user.role === "ADMIN" || session?.user.role === "COLLECTIONS") && (
          <Link
            href="/submissions/new"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New Submission
          </Link>
        )}
      </div>

      {/* Filters */}
      <form className="flex gap-3 mb-6">
        <input
          name="search"
          defaultValue={search}
          placeholder="Search by customer or reference..."
          className="flex-1 max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          name="status"
          defaultValue={status || ""}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {Object.entries(statusLabels).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Filter
        </button>
        {(status || search) && (
          <Link
            href="/submissions"
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {submissions.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No submissions found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Reference</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Channel</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Items</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => {
                const { label, color } = statusLabels[sub.status]
                return (
                  <tr key={sub.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/submissions/${sub.id}`}
                        className="font-mono text-xs text-blue-600 hover:text-blue-800"
                      >
                        {sub.reference.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{sub.customer.name}</td>
                    <td className="px-4 py-3 text-gray-500">{channelLabels[sub.channel]}</td>
                    <td className="px-4 py-3 text-gray-500">{sub._count.items}</td>
                    <td className="px-4 py-3 text-gray-500">{sub.department?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(sub.createdAt).toLocaleDateString("en-GB")}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
