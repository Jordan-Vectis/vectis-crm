// The website's lot descriptions arrive as HTML — <p>, <span>, <br />, &nbsp;, &bull;, &ndash;,
// &auml; — and were stored that way in BcLotWeb (209,842 of 209,856 rows, measured 2026-09-10).
// Jordan: "The BC lots also need all the HTML shit taking out." It showed on screen, it spoiled
// Copy description, and it broke the search: "Märklin" stored as M&auml;rklin never matched.
//
// htmlToText turns it into plain text: paragraphs and line breaks become new lines, every other tag
// goes, and entities become the characters they stand for. No dependency — the handful of entities
// the site actually uses are listed, plus numeric ones.

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">",
  ndash: "–", mdash: "—", bull: "•", middot: "·", hellip: "…",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
  pound: "£", euro: "€", cent: "¢", yen: "¥", copy: "©", reg: "®", trade: "™", deg: "°", times: "×", divide: "÷",
  frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³", para: "¶", sect: "§", dagger: "†",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", euml: "ë", Euml: "Ë", iuml: "ï", Iuml: "Ï", yuml: "ÿ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", yacute: "ý",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Yacute: "Ý",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù", Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û", Acirc: "Â", Ecirc: "Ê", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û",
  atilde: "ã", otilde: "õ", ntilde: "ñ", Atilde: "Ã", Otilde: "Õ", Ntilde: "Ñ",
  aring: "å", Aring: "Å", aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", ccedil: "ç", Ccedil: "Ç", oelig: "œ", OElig: "Œ",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m
  })
}

/** Plain text from the website's HTML. Text with no tags or entities comes back untouched (trimmed). */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return ""
  if (!/[<&]/.test(input)) return input.trim()
  let s = input
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "• ")
    .replace(/<\/\s*(p|div|li|h[1-6]|article|section|ul|ol|tr|table|blockquote)\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
  // Twice, for the site's occasional double-encoding (&amp;nbsp;).
  s = decodeEntities(decodeEntities(s))
  return s
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** True when text still carries HTML tags or entities — what the one-off clean-up looks for. */
export const HTML_IN_TEXT_SQL = `'<[a-zA-Z/!]|&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);'`
