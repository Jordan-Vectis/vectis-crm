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
 * Opening bid = half of the estimate low, rounded down to the nearest valid increment.
 * e.g. estimate £20–£40 → opening bid £10
 */
export function getOpeningBid(estimateLow: number): number {
  const half = estimateLow / 2
  const inc = getIncrement(0) // £5 at the lowest level
  return Math.max(inc, Math.floor(half / inc) * inc)
}

/**
 * Next valid bid above a given amount.
 */
export function nextBid(current: number): number {
  return current + getIncrement(current)
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
