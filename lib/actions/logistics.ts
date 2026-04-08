"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { LogisticsType, SubmissionStatus } from "@/app/generated/prisma/enums"

export async function setLogistics(submissionId: string, formData: FormData) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  const type = formData.get("type") as LogisticsType

  const data =
    type === LogisticsType.COLLECTION
      ? {
          type,
          collectionAddress: formData.get("collectionAddress") as string,
          collectionName: formData.get("collectionName") as string,
          collectionPhone: formData.get("collectionPhone") as string,
          collectionEmail: formData.get("collectionEmail") as string | null,
          collectionNotes: formData.get("collectionNotes") as string | null,
        }
      : { type }

  await prisma.logistics.upsert({
    where: { submissionId },
    create: { submissionId, ...data },
    update: data,
  })

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: SubmissionStatus.COLLECTION_PENDING },
  })

  revalidatePath(`/submissions/${submissionId}`)
}

export async function markArrived(submissionId: string) {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")

  await prisma.logistics.update({
    where: { submissionId },
    data: { arrived: true, arrivedAt: new Date() },
  })

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: SubmissionStatus.ARRIVED },
  })

  revalidatePath(`/submissions/${submissionId}`)
  revalidatePath("/submissions")
}
