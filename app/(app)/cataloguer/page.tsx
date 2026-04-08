import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { SubmissionStatus } from "@/app/generated/prisma/enums"

export default async function CataloguerPage() {
  const session = await auth()
  if (!session) redirect("/login")

  if (session.user.role !== "CATALOGUER" && session.user.role !== "ADMIN") {
    redirect("/submissions")
  }

  // For admins, show all; for cataloguers, show their department submissions
  const whereClause =
    session.user.role === "ADMIN"
      ? { status: SubmissionStatus.PENDING_VALUATION }
      : {
          AND: [
            { status: SubmissionStatus.PENDING_VALUATION },
            {
              OR: [
                { cataloguerId: session.user.id },
                ...(session.user.departmentId
                  ? [{ departmentId: session.user.departmentId }]
                  : []),
              ],
            },
          ],
        }

  const submissions = await prisma.submission.findMany({
    where: whereClause,
    include: {
      customer: true,
      department: true,
      cataloguer: true,
      items: { include: { valuation: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Valuations</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Submissions awaiting valuation in your department
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">No submissions awaiting valuation.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((sub) => {
            const valuedCount = sub.items.filter((i) => i.valuation).length
            const totalItems = sub.items.length
            const isAssignedToMe = sub.cataloguerId === session.user.id
            const progress = totalItems > 0 ? Math.round((valuedCount / totalItems) * 100) : 0

            return (
              <div key={sub.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{sub.customer.name}</h3>
                      {isAssignedToMe ? (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Assigned to you</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{sub.department?.name}</span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-gray-400 mt-0.5">
                      {sub.reference.slice(0, 8).toUpperCase()}
                    </p>
                  </div>
                  <Link
                    href={`/submissions/${sub.id}`}
                    className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg transition-colors"
                  >
                    Value items
                  </Link>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                    <span>{valuedCount} of {totalItems} items valued</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  {sub.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.valuation ? "bg-green-500" : "bg-gray-300"}`} />
                      <span className={item.valuation ? "text-gray-400 line-through" : ""}>{item.name}</span>
                      {item.valuation && (
                        <span className="text-green-600 font-medium">
                          &pound;{item.valuation.estimatedValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-gray-400 mt-3">
                  Received {new Date(sub.createdAt).toLocaleDateString("en-GB")}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
