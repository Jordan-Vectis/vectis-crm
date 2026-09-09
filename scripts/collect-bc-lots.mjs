// Collect the Business Central lots' full descriptions and photo paths from vectis.co.uk.
//
//   node scripts/collect-bc-lots.mjs <firstSale> <lastSale> <outputFolder>
//
// ⚠⚠ WHY THIS EXISTS. The Hub's Railway server cannot read the website — it gets 202 and an empty
// body for every sale — while the same request from a machine in the Vectis office returns the lots
// normally. Business Central holds the full description and the photo path but publishes neither.
// So the collecting is done from an office machine and the files are loaded on the Hub at
// Databases → BC Database → "Update the BC lots".
//
// ⚠ It is the SAME logic as the browser collector in lib/bc-web-collector.ts. Change one, change
// the other. It writes what writeBcSale() reads and nothing else, only from FINISHED sales, only
// lots whose unique_id is BC-shaped (r009030-1), in files capped under Railway's 20 MB body limit.
//
// MEASURED, 2026-09-09 (a full run collected 216,259 lots from 375 sales, matching Business
// Central's own auction list exactly — 375 of the 375 sales dated that day or earlier):
//   · the site answers 500 for a sale number that does not exist — that is not an error;
//   · sale numbers are sparse (1450 and 1500 missing while 1541 exists), so a run must cover its
//     whole range rather than stop after N misses in a row;
//   · BC sales run from site number 1062 (B007) to 1558; everything below is the old system;
//   · a sale is all one era, so ten lots are enough to tell which — that probe is what stops a run
//     downloading a thousand pre-BC sales in full.
import fs from "node:fs"
import path from "node:path"

const FROM = Number(process.argv[2] ?? 1062)
const TO = Number(process.argv[3] ?? 1700)
const OUT = process.argv[4] ?? "."
const STATE = path.join(OUT, "vectis-bc-lots-state.json")
const MB = 12, PER = 500, PAUSE = 250

const H = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-GB,en;q=0.9",
  "Referer": "https://www.vectis.co.uk/",
  "Origin": "https://www.vectis.co.uk",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
}
const FEED = "https://www.vectis.co.uk/index.php?option=com_bidding&format=json&task=commission.getLots"
const sleep = ms => new Promise(r => setTimeout(r, ms))
const isBc = u => /^r\d+-\d+$/i.test(String(u ?? "").trim())
const codeOf = l => { const m = String(l?.sef_link ?? "").match(/^\/?bidding\/([A-Za-z]\d+)-/); return m ? m[1].toUpperCase() : null }

fs.mkdirSync(OUT, { recursive: true })
const say = s => {
  const line = new Date().toISOString().slice(11, 19) + " " + s
  console.log(line)
  try { fs.appendFileSync(path.join(OUT, "vectis-bc-lots-log.txt"), line + "\n") } catch {}
}

let refusals = 0, hardFails = 0
const failed = []

async function feed(saleId, page, per) {
  const body = new URLSearchParams({
    per_page: String(per), current_page: String(page), auction_id: String(saleId),
    lot_order: "", sale_type: "", keyword: "", cate_arr: "[]", sub_cate_arr: "[]",
    extended_attrs_obj: "{}", low_estimate: "", high_estimate: "", catalogue_layout_header_id: "0",
  })
  for (let go = 1; go <= 4; go++) {
    let res
    try { res = await fetch(FEED, { method: "POST", headers: H, body }) }
    catch { await sleep(2000 * go); continue }                  // a network hiccup — try again
    if (res.status === 500 || res.status === 404) return null   // measured: no sale with that number
    if (!res.ok) { await sleep(2000 * go); continue }           // 429/502/503 — transient, try again
    const text = (await res.text()).trim()
    if (!text) return null
    try { const j = JSON.parse(text); return Array.isArray(j.lots) ? j : null }
    catch { refusals++; return null }
  }
  hardFails++
  return null
}

async function readWholeSale(saleId, expected) {
  const all = []
  for (let page = 1; page <= 80; page++) {
    const j = await feed(saleId, page, PER)
    if (!j || !j.lots.length) break
    all.push(...j.lots)
    if (j.lots.length < PER || all.length >= (Number(j.total_lots) || expected)) break
    await sleep(PAUSE)
  }
  return all
}

let sales = [], lots = 0, bytes = 0, part = 1
let bcSales = 0, oldSales = 0, unfinished = 0, gaps = 0, shortSales = 0
let firstBc = null, lastBc = null

const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")) } catch { return null } })()
let at = (prev && prev.from === FROM && prev.to === TO && prev.next > FROM) ? prev.next : FROM
if (prev && at > FROM) { part = prev.part ?? 1; lots = prev.lots ?? 0; bcSales = prev.bcSales ?? 0; firstBc = prev.firstBc ?? null }

// ⚠ The resume position only ever moves when lots are safely inside a saved FILE. Killed halfway,
// it re-collects at most one file's worth — which the Hub de-duplicates — rather than stepping over
// sales nobody ever saved.
function remember(next) { try { fs.writeFileSync(STATE, JSON.stringify({ from: FROM, to: TO, next, part, lots, bcSales, firstBc }, null, 1)) } catch {} }

function save(nextId) {
  if (!sales.length) return
  const name = "vectis-bc-lots-" + String(part).padStart(2, "0") + ".json"
  fs.writeFileSync(path.join(OUT, name), JSON.stringify({ collectedAt: new Date().toISOString(), sales }))
  const mb = (fs.statSync(path.join(OUT, name)).size / 1048576).toFixed(1)
  say("SAVED " + name + " — " + mb + " MB · " + lots.toLocaleString() + " lots so far")
  part++; sales = []; bytes = 0
  remember(nextId)
}

say("Collecting BC lots from sales " + at + " to " + TO + " into " + OUT)

for (; at <= TO; at++) {
  // One small request first: it says whether the sale exists and whether it is a Business Central
  // one, so the old sales are skipped instead of downloaded in full.
  const probe = await feed(at, 1, 10)
  if (!probe || !probe.lots.length) {
    gaps++
    if (at % 100 === 0) say("… at sale " + at + " · " + bcSales + " BC sales · " + lots.toLocaleString() + " lots")
    await sleep(PAUSE); continue
  }
  const code = codeOf(probe.lots[0]) ?? codeOf(probe.lots[probe.lots.length - 1])
  if (!probe.lots.some(l => isBc(l.unique_id))) {
    oldSales++
    if (at % 25 === 0) say("… at sale " + at + " · older sales skipped so far: " + oldSales)
    await sleep(PAUSE); continue
  }

  // ⚠⚠ FROM HERE THE SALE IS KNOWN TO HOLD BC LOTS, so coming away with nothing is a FAILURE, never
  // "no lots". Before this it was silent: one 503 on the heavy per_page=500 request and the whole
  // sale — 600 descriptions that exist nowhere else — vanished with no line printed, no counter
  // moved, and a closing summary that read exactly like a perfect run.
  const expected = Number(probe.total_lots) || 0
  let all = []
  for (let go = 1; go <= 3; go++) {
    all = await readWholeSale(at, expected)
    if (all.length) break
    say("sale " + at + " · " + (code ?? "?") + " · came back empty, trying again (" + go + " of 3)")
    await sleep(5000 * go)
  }
  if (!all.length) {
    failed.push(at + (code ? " (" + code + ")" : ""))
    say("⚠ sale " + at + " · " + (code ?? "?") + " · COULD NOT BE READ — it has BC lots but the website would not hand them over")
    await sleep(PAUSE); continue
  }

  // ⚠ Same rule as the Hub's own walk: only a sale whose lots are all finished is written.
  if (!all.every(l => !!l.isFinished)) {
    unfinished++
    say("sale " + at + " · " + (code ?? "?") + " · not finished yet, skipped")
    await sleep(PAUSE); continue
  }

  const keep = all.filter(l => isBc(l.unique_id)).map(l => ({
    unique_id: l.unique_id, lot_number: l.lot_number, description: l.description,
    id: l.id, sef_link: l.sef_link, image: l.image, hammer_price: l.hammer_price, sold: l.sold,
  }))
  if (keep.length) {
    const row = { siteId: at, auctionCode: code, lots: keep }
    sales.push(row); lots += keep.length; bytes += JSON.stringify(row).length
    bcSales++; if (firstBc === null) firstBc = at; lastBc = at
    const short = expected && all.length < expected
    if (short) shortSales++
    say("sale " + at + " · " + (code ?? "?") + " · " + keep.length + " BC lots" + (short ? "  ⚠ only got " + all.length + " of " + expected : ""))
    if (bytes > MB * 1048576) save(at + 1)
  }
  await sleep(PAUSE)
}

save(TO + 1)
if (!failed.length) { try { fs.unlinkSync(STATE) } catch {} } else { remember(TO + 1) }
say("FINISHED — " + lots.toLocaleString() + " BC lots from " + bcSales + " sales, in " + (part - 1) + " file(s)")
say("BC sales ran from site number " + firstBc + " to " + lastBc + " · " + oldSales + " older sales skipped · " +
    unfinished + " not finished · " + gaps + " numbers with no sale" +
    (shortSales ? " · ⚠ " + shortSales + " sale(s) came back short" : "") +
    (refusals ? " · ⚠ " + refusals + " unreadable replies" : "") +
    (hardFails ? " · ⚠ " + hardFails + " requests gave up after 4 tries" : ""))
if (failed.length) say("⚠ " + failed.length + " sale(s) could NOT be read and are missing: " + failed.join(", ") + " — run it again to pick them up")
