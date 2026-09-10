import { prisma } from "@/lib/prisma"
import type { NotificationView } from "@/lib/status/types"

// 🔔 The admin bell's notifications (top bar, just before the settings cog).
//
// Jordan chose a bell over email alerts (2026-09-10) — the Hub sends no email at
// all. Built general-purpose so other tools can raise one later, but today the
// only writer is the Status Centre, and only admins see the bell.
//
// Unread = created after the person last opened the bell (NotificationSeen.seenAt),
// so "mark as read" is one row per person, not one row per notification.
//
// ⚠ Migration-safe everywhere: before Run Migrations creates the tables these
// return empty rather than throwing, so the top bar can never break a page.

export type NotificationLevel = NotificationView["level"]

export async function createNotification(n: {
  kind: string
  level: NotificationLevel
  title: string
  body?: string | null
  href?: string | null
  audience?: string
}): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: {
        kind: n.kind,
        level: n.level,
        title: n.title.slice(0, 200),
        body: n.body ?? null,
        href: n.href ?? null,
        audience: n.audience ?? "ADMIN",
      },
      select: { id: true },
    })
    // Instant delivery to open tabs, same as the announcement banner. Optional-chained:
    // a no-op under `next dev`, and the bell also polls as a fallback.
    ;(globalThis as { _io?: { emit: (event: string) => void } })._io?.emit("notifications:changed")
    return true
  } catch (e) {
    console.warn("[notifications] could not create:", (e as Error)?.message)
    return false
  }
}

export async function listNotifications(userId: string, limit = 30): Promise<{
  unread: number
  items: NotificationView[]
  seenAt: string | null
  available: boolean
}> {
  try {
    const [items, seen] = await Promise.all([
      prisma.notification.findMany({
        where: { audience: "ADMIN" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, level: true, title: true, body: true, href: true, createdAt: true },
      }),
      prisma.notificationSeen.findUnique({ where: { userId }, select: { seenAt: true } }),
    ])
    const seenAt = seen?.seenAt ?? null
    const unread = await prisma.notification.count({
      where: { audience: "ADMIN", ...(seenAt ? { createdAt: { gt: seenAt } } : {}) },
    })
    return {
      unread,
      seenAt: seenAt?.toISOString() ?? null,
      available: true,
      items: items.map(i => ({
        id: i.id,
        level: i.level as NotificationLevel,
        title: i.title,
        body: i.body,
        href: i.href,
        createdAt: i.createdAt.toISOString(),
      })),
    }
  } catch {
    return { unread: 0, items: [], seenAt: null, available: false }
  }
}

export async function markNotificationsSeen(userId: string): Promise<boolean> {
  try {
    const now = new Date()
    await prisma.notificationSeen.upsert({
      where: { userId },
      create: { userId, seenAt: now },
      update: { seenAt: now },
      select: { userId: true },
    })
    return true
  } catch {
    return false
  }
}
