const RM_BASE = "https://api.parcel.royalmail.com/api/v1"

export const RM_SERVICES: Record<string, string> = {
  CRL1:  "1st Class",
  CRL2:  "2nd Class",
  TPP24: "Tracked 24",
  TPP48: "Tracked 48",
  STL1:  "Special Delivery (Next Day by 1pm)",
  STL2:  "Special Delivery (Saturday by 1pm)",
}

/** Maps service code → required packageFormatIdentifier. Null = omit the field entirely. */
export const RM_SERVICE_FORMATS: Record<string, string | null> = {
  TPNN: "SmallParcel",
  TPNS: "SmallParcel",
  TPSN: "SmallParcel",
  TPSS: "SmallParcel",
  FEO:  null, // courier — no format identifier
  FEM:  null, // courier — no format identifier
  NDA:  null, // courier — no format identifier
  SD1:  "SmallParcel",
  SD2:  "SmallParcel",
  SD3:  "SmallParcel",
  SEB:  "SmallParcel",
  SEC:  "SmallParcel",
  SED:  "SmallParcel",
}

export const RM_FORMATS: Record<string, string> = {
  Letter:       "Letter",
  LargeLetter:  "Large Letter",
  SmallParcel:  "Small Parcel",
  MediumParcel: "Medium Parcel",
}

export interface RmRecipient {
  address: {
    fullName:     string
    companyName?: string
    addressLine1: string
    addressLine2?: string
    city:         string
    county?:      string
    postcode:     string
    countryCode:  string
  }
  emailAddress?: string
  mobilePhone?:  string
}

export interface RmOrderPayload {
  orderReference?:      string
  orderDate:            string  // "YYYY-MM-DD"
  plannedDespatchDate?: string  // "YYYY-MM-DD"
  subtotal:             number
  shippingCostCharged:  number
  total:                number
  recipient:            RmRecipient
  billing?: {
    address: {
      fullName?:    string
      companyName?: string
      addressLine1: string
      addressLine2?: string
      city:         string
      county?:      string
      postcode:     string
      countryCode?: string
    }
  }
  packages: {
    weightInGrams:             number
    packageFormatIdentifier?:  string
    contents?: {
      name:              string
      quantity:          number
      unitValue:         number
      unitWeightInGrams: number
    }[]
  }[]
  postageDetails?: {
    serviceCode:          string
    sendNotificationsTo?: string
  }
  specialInstructions?: string
}

async function rmFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const key = process.env.ROYAL_MAIL_API_KEY
  if (!key) throw new Error("ROYAL_MAIL_API_KEY is not set")

  const url = `${RM_BASE}${path}`

  if (options.body) {
    console.log("[RoyalMail] →", options.method ?? "GET", url)
    console.log("[RoyalMail] payload:", options.body)
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization:  `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    console.error("[RoyalMail] ✗", res.status, text)
    const err: any = new Error(`Royal Mail API ${res.status}: ${text}`)
    err.status = res.status
    err.body = text
    throw err
  }

  return res
}

/** Create one or more orders. Returns the RM response JSON. */
export async function createRmOrders(orders: RmOrderPayload[]) {
  const res = await rmFetch("/orders", {
    method: "POST",
    body: JSON.stringify({ items: orders }), // RM requires { items: [...] } wrapper
  })
  return res.json()
}

/** Get a PDF label for a given RM order identifier. Returns ArrayBuffer. */
export async function getRmLabel(orderIdentifier: string): Promise<ArrayBuffer> {
  const res = await rmFetch(`/orders/${encodeURIComponent(orderIdentifier)}/label?documentType=postageLabel&includeReturnsLabel=false`)
  return res.arrayBuffer()
}

/** Create an end-of-day manifest. Returns the RM response JSON. */
export async function createRmManifest() {
  const res = await rmFetch("/manifests", { method: "POST" })
  return res.json()
}

/** Get manifest details. */
export async function getRmManifest(manifestId: string) {
  const res = await rmFetch(`/manifests/${encodeURIComponent(manifestId)}`)
  return res.json()
}

/** Update order status (e.g. mark as despatched). */
export async function updateRmOrderStatus(orderIdentifiers: string[], status: string) {
  const res = await rmFetch("/orders/status", {
    method: "PUT",
    body: JSON.stringify({ orderIdentifiers, status }),
  })
  return res.json()
}
