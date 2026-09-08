import { COUNTRY_NAMES, COUNTRY_ALIASES } from "@/lib/country-names"

// Working out which country a vendor is in from their address.
//
// ⚠⚠ WHY THIS HAS TO EXIST. Business Central holds NO country for our vendors — measured on the
// live data 2026-09-08: 28,998 vendors pulled, **0** with a country on file. Evo's auction-vendor
// API has no country field at all, and the standard vendors entity returns it blank. So without
// this the report can only ever say "United Kingdom" and "Not known", which is not a report.
//
// ⚠ EVERY ANSWER CARRIES THE REASON IT WAS GIVEN. Nothing here is written back to Business Central
// or to the vendor record — it is worked out at read time, shown with the rule that decided it, and
// anything the rules cannot place stays "Not known" and is listed in full. A tidier headline built
// on a guess would be worse than an honest gap.
//
// ⚠ ORDER MATTERS. The most specific, least collidable signals run first (postcode shapes that
// only one country uses), then state/province names, then a country name written in the address.
// A five-digit postcode on its own is NOT enough — France, Spain, Germany, Italy and the USA all
// use one — so it is only accepted alongside a state or a country name.

export type CountryGuess = {
  /** ISO alpha-2, or null when nothing could place them. */
  code:   string | null
  /** Plain-English reason, shown on screen next to the count. */
  reason: string
}

export type VendorAddress = {
  address?:  string | null
  address2?: string | null
  city?:     string | null
  county?:   string | null
  postCode?: string | null
  countryCode?: string | null
}

const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase()
const squash = (v: string | null | undefined) => up(v).replace(/\s+/g, "")

/** UK: AA9A 9AA and friends. The last two characters are always letters, which is what keeps
 *  Canadian codes (which end in a digit) out. */
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/
/** Canada: A9A 9A9. */
const CA_POSTCODE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/
/** Ireland Eircode: routing key + 4. Excludes the letters Eircode never uses (B, G, I, J, L, M, O, Q, S, U, W, X, Z as the first char). */
const IE_EIRCODE  = /^[AC-FHKNPRTV-Y]\d{2}[0-9AC-FHKNPRTV-Y]{4}$/
/** Netherlands: 9999 AA. */
const NL_POSTCODE = /^\d{4}[A-Z]{2}$/
/** USA ZIP or ZIP+4. Not decisive on its own — see the note above. */
const US_ZIP      = /^\d{5}(\d{4})?$/

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA",
  "RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
  "ALABAMA","ALASKA","ARIZONA","ARKANSAS","CALIFORNIA","COLORADO","CONNECTICUT","DELAWARE",
  "FLORIDA","GEORGIA","HAWAII","IDAHO","ILLINOIS","INDIANA","IOWA","KANSAS","KENTUCKY","LOUISIANA",
  "MAINE","MARYLAND","MASSACHUSETTS","MICHIGAN","MINNESOTA","MISSISSIPPI","MISSOURI","MONTANA",
  "NEBRASKA","NEVADA","NEW HAMPSHIRE","NEW JERSEY","NEW MEXICO","NEW YORK","NORTH CAROLINA",
  "NORTH DAKOTA","OHIO","OKLAHOMA","OREGON","PENNSYLVANIA","RHODE ISLAND","SOUTH CAROLINA",
  "SOUTH DAKOTA","TENNESSEE","TEXAS","UTAH","VERMONT","VIRGINIA","WASHINGTON","WEST VIRGINIA",
  "WISCONSIN","WYOMING",
])

const CA_PROVINCES = new Set([
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
  "ALBERTA","BRITISH COLUMBIA","MANITOBA","NEW BRUNSWICK","NEWFOUNDLAND","NEWFOUNDLAND AND LABRADOR",
  "NOVA SCOTIA","NORTHWEST TERRITORIES","NUNAVUT","ONTARIO","PRINCE EDWARD ISLAND","QUEBEC",
  "SASKATCHEWAN","YUKON",
])

const AU_STATES = new Set([
  "NSW","VIC","QLD","SA","WA","TAS","NT","ACT",
  "NEW SOUTH WALES","VICTORIA","QUEENSLAND","SOUTH AUSTRALIA","WESTERN AUSTRALIA","TASMANIA",
  "AUSTRALIAN CAPITAL TERRITORY",
])

/** Regions that name their country unambiguously enough to use. Kept deliberately short — every
 *  entry here is a claim, and a wrong one silently moves a vendor to another country. */
const REGION_TO_COUNTRY: Record<string, string> = {
  "ZUID HOLLAND": "NL", "NOORD HOLLAND": "NL", "NOORD-HOLLAND": "NL", "ZUID-HOLLAND": "NL",
  "GELDERLAND": "NL", "UTRECHT": "NL", "NOORD BRABANT": "NL", "NOORD-BRABANT": "NL",
  "OSLO & VIKEN": "NO", "OSLO OG VIKEN": "NO", "VIKEN": "NO",
  "VLAANDEREN": "BE", "WEST-VLAANDEREN": "BE", "OOST-VLAANDEREN": "BE", "ANTWERPEN": "BE",
  "BAYERN": "DE", "NORDRHEIN-WESTFALEN": "DE", "BADEN-WURTTEMBERG": "DE",
  "CAPITAL FEDERAL": "AR", "CAPTIAL FEDERAL": "AR",   // BC holds the typo — kept on purpose
  "AUCKLAND": "NZ", "WELLINGTON": "NZ",
}

/** Country names as they might be typed into an address line. Built from the shared list, plus the
 *  everyday spellings people actually use. */
const NAME_TO_CODE: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [code, name] of Object.entries(COUNTRY_NAMES)) m[name.toUpperCase()] = code
  Object.assign(m, {
    "UK": "GB", "U.K.": "GB", "GREAT BRITAIN": "GB", "ENGLAND": "GB", "SCOTLAND": "GB",
    "WALES": "GB", "NORTHERN IRELAND": "GB",
    "USA": "US", "U.S.A.": "US", "UNITED STATES OF AMERICA": "US", "AMERICA": "US",
    "HOLLAND": "NL", "THE NETHERLANDS": "NL", "NEDERLAND": "NL",
    "DEUTSCHLAND": "DE", "EIRE": "IE", "REPUBLIC OF IRELAND": "IE",
    "ESPANA": "ES", "ESPAÑA": "ES", "ITALIA": "IT", "SVERIGE": "SE", "NORGE": "NO",
    "DANMARK": "DK", "SUOMI": "FI", "BELGIE": "BE", "BELGIQUE": "BE", "SCHWEIZ": "CH",
    "OSTERRICH": "AT", "ÖSTERREICH": "AT",
  })
  return m
})()

/**
 * Work out the country. Returns null when nothing places them — never a guess.
 *
 * `countryCode` from BC wins outright when it is present. It never is today, but if Evo ever adds
 * the field this quietly starts trusting it instead.
 */
export function guessCountry(v: VendorAddress): CountryGuess {
  const given = up(v.countryCode)
  if (given) {
    const code = COUNTRY_ALIASES[given] ?? given
    return { code, reason: "Country held in Business Central" }
  }

  const pc     = squash(v.postCode)
  const county = up(v.county)
  const city   = up(v.city)
  const lines  = [up(v.address), up(v.address2), city, county].filter(Boolean)

  // 1. Postcode shapes only one country uses.
  if (pc && UK_POSTCODE.test(pc)) return { code: "GB", reason: "UK postcode" }
  if (pc && CA_POSTCODE.test(pc)) return { code: "CA", reason: "Canadian postcode" }
  if (pc && NL_POSTCODE.test(pc)) return { code: "NL", reason: "Dutch postcode" }
  // Eircode is checked after the UK shapes because Northern Ireland uses UK codes.
  if (pc && IE_EIRCODE.test(pc) && pc.length === 7) return { code: "IE", reason: "Irish Eircode" }

  // 2. A state or province names its country outright.
  if (county && US_STATES.has(county))    return { code: "US", reason: "US state" }
  if (county && CA_PROVINCES.has(county)) return { code: "CA", reason: "Canadian province" }
  if (county && AU_STATES.has(county))    return { code: "AU", reason: "Australian state" }
  if (county && REGION_TO_COUNTRY[county]) return { code: REGION_TO_COUNTRY[county], reason: "Region name" }

  // 3. A country written into the address.
  for (const line of lines) {
    const direct = NAME_TO_CODE[line]
    if (direct) return { code: direct, reason: "Country named in the address" }
  }
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (name.length < 5) continue          // don't match "UK" or "USA" inside a word
    if (lines.some(l => l.includes(name))) return { code, reason: "Country named in the address" }
  }

  // 4. A US ZIP alongside anything American. A bare five digits is France, Spain, Germany, Italy
  //    and the USA all at once, so it is never enough on its own.
  if (pc && US_ZIP.test(pc) && (US_STATES.has(county) || lines.some(l => l.includes("USA") || l.includes("UNITED STATES")))) {
    return { code: "US", reason: "US ZIP code" }
  }

  return { code: null, reason: "Not enough in the address to tell" }
}
