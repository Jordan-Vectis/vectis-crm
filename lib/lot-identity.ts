// The shape of a lot's identity trio — Tote, Vendor (customer) and Receipt.
//
// ⚠ Jordan, 2026-09-08: "receipts customers and totes are ALWAYS 7 characters so the limits are
// on purpose." So `maxLength={7}` on those boxes is a deliberate, correct rule — never raise it.
// What was missing is the other half: nothing anywhere checked the LEADING LETTER, so seven
// characters of the wrong shape (a receipt typed into the Vendor box, a T-tote typed as a P-tote)
// passed every gate in the app.
//
// One source of truth, shared by the lot wizard's step 1, the tablet lot editor and the desktop
// lot editor, so the screen used to CORRECT a wrong vendor can never validate less than the screen
// that created it — which is exactly how it was until now.
//
// ⚠ These are WARNINGS, never blocks. Jordan asked for "a warning if it's less than 7". A hard
// block on a format guess would stop cataloguing dead if a number ever came through in another
// shape; a warning that names the field costs nothing and cannot strand anybody.

export type IdentityKind = "tote" | "vendor" | "receipt"

export type IdentityProblem =
  | "short"   // fewer than 7 characters (maxLength stops it ever being more)
  | "shape"   // 7 characters, but the wrong leading letter or a non-digit body

export type IdentityCheck = {
  ok:       boolean
  problem?: IdentityProblem
  message?: string
}

export const IDENTITY_LENGTH = 7

/** Tote numbers are P or T + 6 digits (P005022, T024808). */
export const TOTE_RE    = /^[PT]\d{6}$/i
/** Customer / vendor numbers are C + 6 digits (C224521). */
export const VENDOR_RE  = /^C\d{6}$/i
/** Receipt numbers are R + 6 digits (R007523). */
export const RECEIPT_RE = /^R\d{6}$/i

const SPEC: Record<IdentityKind, { label: string; re: RegExp; expected: string }> = {
  tote:    { label: "Tote",    re: TOTE_RE,    expected: "P or T followed by 6 numbers, like P005022" },
  vendor:  { label: "Vendor",  re: VENDOR_RE,  expected: "C followed by 6 numbers, like C224521" },
  receipt: { label: "Receipt", re: RECEIPT_RE, expected: "R followed by 6 numbers, like R007523" },
}

/**
 * Check one field. An EMPTY value returns ok — emptiness is the existing "required" validation's
 * job and warning about a box someone has not filled in yet would fire on every keystroke of the
 * first character.
 */
export function checkIdentity(kind: IdentityKind, raw: string | null | undefined): IdentityCheck {
  const value = (raw ?? "").trim()
  if (!value) return { ok: true }

  const spec = SPEC[kind]
  if (value.length !== IDENTITY_LENGTH) {
    return {
      ok: false,
      problem: "short",
      // Deliberately says ALWAYS, not "normally". The old wizard wording called the rule
      // "normally exactly 7 characters", which reads as a suggestion.
      message: `A ${spec.label.toLowerCase()} number is always ${IDENTITY_LENGTH} characters — this one is ${value.length}.`,
    }
  }
  if (!spec.re.test(value)) {
    return {
      ok: false,
      problem: "shape",
      message: `That does not look like a ${spec.label.toLowerCase()} number. Expected ${spec.expected}.`,
    }
  }
  return { ok: true }
}

/** Check all three at once. Returns one line per field that is wrong, in field order. */
export function checkIdentityTrio(v: { tote?: string | null; vendor?: string | null; receipt?: string | null }): string[] {
  const out: string[] = []
  for (const kind of ["tote", "vendor", "receipt"] as const) {
    const res = checkIdentity(kind, v[kind])
    if (!res.ok && res.message) out.push(res.message)
  }
  return out
}

/**
 * Which kind of number does this look like? Used to say "that is a receipt number" when a receipt
 * has been typed into the Vendor box, which is the single most useful thing the shape check can
 * tell somebody — it names the mistake instead of just refusing the value.
 */
export function looksLike(raw: string | null | undefined): IdentityKind | null {
  const value = (raw ?? "").trim()
  if (TOTE_RE.test(value))    return "tote"
  if (VENDOR_RE.test(value))  return "vendor"
  if (RECEIPT_RE.test(value)) return "receipt"
  return null
}

/** "Vendor" / "Tote" / "Receipt" for use in a message. */
export function identityLabel(kind: IdentityKind): string {
  return SPEC[kind].label
}

/**
 * The full warning for one field, including the "that is actually a receipt number" hint.
 * Returns null when the value is fine (or empty).
 */
export function identityWarning(kind: IdentityKind, raw: string | null | undefined): string | null {
  const res = checkIdentity(kind, raw)
  if (res.ok) return null
  if (res.problem === "shape") {
    const actually = looksLike(raw)
    if (actually && actually !== kind) {
      return `That is a ${identityLabel(actually).toLowerCase()} number, not a ${identityLabel(kind).toLowerCase()} number.`
    }
  }
  return res.message ?? null
}
