"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

export async function getHeroSlides() {
  return prisma.heroSlide.findMany({
    orderBy: { order: "asc" },
  })
}

export async function createHeroSlide(data: {
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey?: string | null
  order?: number
}) {
  const maxOrder = await prisma.heroSlide.aggregate({ _max: { order: true } })
  await prisma.heroSlide.create({
    data: {
      ...data,
      order: data.order ?? (maxOrder._max.order ?? -1) + 1,
    },
  })
  revalidatePath("/")
  revalidatePath("/website/banner")
}

export async function updateHeroSlide(
  id: string,
  data: Partial<{
    title: string
    subtitle: string
    cta: string
    ctaHref: string
    imageKey: string | null
    active: boolean
    order: number
  }>
) {
  await prisma.heroSlide.update({ where: { id }, data })
  revalidatePath("/")
  revalidatePath("/website/banner")
}

export async function deleteHeroSlide(id: string) {
  await prisma.heroSlide.delete({ where: { id } })
  revalidatePath("/")
  revalidatePath("/website/banner")
}

export async function reorderHeroSlides(ids: string[]) {
  await Promise.all(
    ids.map((id, i) => prisma.heroSlide.update({ where: { id }, data: { order: i } }))
  )
  revalidatePath("/")
  revalidatePath("/website/banner")
}
