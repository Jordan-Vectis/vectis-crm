// Is the database refusing writes?
//
// ⚠⚠ WHY THIS EXISTS (2026-09-09). For about an hour production's Neon compute came up with
// `default_transaction_read_only = on`. Every INSERT was refused with Postgres 25006 — "cannot
// execute INSERT in a read-only transaction" — while every SELECT worked perfectly, so the app
// looked entirely healthy: pages loaded, lots listed, searches ran. Cataloguers carried on
// working for an hour and lost the lot. What they saw was one refused save at a time, worded as
// Next's production boilerplate ("the specific message is omitted in production builds"), plus
// their tote and vendor quietly reverting to the previous batch — because remembering those is a
// write too, and it had failed as well.
//
// The failure to fix is not the outage. It is that the app let people keep working into a wall.
// One refused save is enough to know that NOTHING will save, and that is worth stopping for.
//
// 25006 is `read_only_sql_transaction`. It is also what you get from a Neon read replica, a
// managed failover, or a provider putting a project into read-only for exceeding a limit — all of
// which mean the same thing to a cataloguer: stop, nothing is being kept.

/** What a person is told. Plain words, no jargon, and it says what to DO. */
export const DB_READ_ONLY_MESSAGE =
  "The database is not accepting anything new at the moment, so nothing you enter can be saved. " +
  "Stop cataloguing and tell IT. Your work will not be kept until this clears."

/** Postgres SQLSTATE for a write attempted in a read-only transaction. */
const READ_ONLY_SQLSTATE = "25006"

/**
 * True when this error is the database refusing a write.
 *
 * ⚠ Walks the cause chain. Prisma 7 with the pg adapter wraps it as a `DriverAdapterError` whose
 * `cause` carries `code` / `originalCode` — the outer error carries neither, so a shallow check
 * finds nothing. The message test is the backstop for anything that reaches us as text only
 * (a serialised error, a different adapter, a future Prisma version).
 */
export function isReadOnlyDbError(e: unknown): boolean {
  let node: any = e
  for (let depth = 0; node && depth < 6; depth++) {
    if (node.code === READ_ONLY_SQLSTATE || node.originalCode === READ_ONLY_SQLSTATE) return true
    const text = typeof node.message === "string" ? node.message
               : typeof node.originalMessage === "string" ? node.originalMessage
               : ""
    if (/read-only transaction/i.test(text)) return true
    node = node.cause
  }
  return false
}

/** What an action returns instead of throwing, so the wizard can stop the cataloguer. */
export type DbReadOnlyBlock = { dbReadOnly: true; message: string }

export const dbReadOnlyBlock = (): DbReadOnlyBlock => ({ dbReadOnly: true, message: DB_READ_ONLY_MESSAGE })

/** Narrowing helper for whatever a server action handed back. */
export function isDbReadOnlyBlock(res: unknown): res is DbReadOnlyBlock {
  return !!res && typeof res === "object" && (res as { dbReadOnly?: boolean }).dbReadOnly === true
}
