/**
 * Vectis bid increment table.
 * Returns the correct increment for a given current bid amount.
 */
export function getIncrement(amount: number): number {
  if (amount < 50)     return 5
  if (amount < 200)    return 10
  if (amount < 700)    return 20
  if (amount < 1000)   return 50
  if (amount < 3000)   return 100
  if (amount < 7000)   return 200
  if (amount < 10000)  return 500
  return 1000
}

/**
 * Minimum opening bid = 60% of estimate low, rounded UP to the nearest valid increment.
 * e.g. estimate £160–£260 → 60% = £96 → rounded up to nearest £10 = £100
 * e.g. estimate £20–£40   → 60% = £12 → rounded up to nearest £5  = £15
 */
export function getOpeningBid(estimateLow: number): number {
  const threshold = estimateLow * 0.6
  const inc = getIncrement(threshold)
  return Math.max(inc, Math.ceil(threshold / inc) * inc)
}

/**
 * Returns the minimum valid bid for a lot.
 * If no estimate, minimum is £5.
 */
export function getMinBid(estimateLow: number | null): number {
  if (!estimateLow || estimateLow <= 0) return 5
  return getOpeningBid(estimateLow)
}

/**
 * Next valid bid above a given amount.
 */
export function nextBid(current: number): number {
  return current + getIncrement(current)
}

/**
 * Returns true if amount lands exactly on an increment boundary.
 * e.g. £18 → false (should be £20), £20 → true
 */
export function isValidBid(amount: number): boolean {
  if (amount <= 0) return false
  return amount % getIncrement(amount) === 0
}

/**
 * Round an arbitrary amount UP to the nearest valid bid boundary.
 * e.g. £18 → £20, £55 → £60, £100 → £100
 */
export function roundUpToBid(amount: number): number {
  const inc = getIncrement(amount)
  if (amount % inc === 0) return amount
  return Math.ceil(amount / inc) * inc
}

export const INCREMENT_TABLE = [
  { from: 5,     to: 50,    inc: 5    },
  { from: 50,    to: 200,   inc: 10   },
  { from: 200,   to: 700,   inc: 20   },
  { from: 700,   to: 1000,  inc: 50   },
  { from: 1000,  to: 3000,  inc: 100  },
  { from: 3000,  to: 7000,  inc: 200  },
  { from: 7000,  to: 10000, inc: 500  },
  { from: 10000, to: null,  inc: 1000 },
] as const
