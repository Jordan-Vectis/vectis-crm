// The script Jordan pastes into the browser console ON vectis.co.uk to collect the Business
// Central lots' full descriptions and photo paths.
//
// ⚠⚠ WHY THIS EXISTS. The website answers our Railway server with **202 and an empty body** for
// every request, while the identical request from a desk in the office returns the lots normally
// (measured 2026-09-09, with browser headers, on two known sales). So the server cannot read the
// lot feed and no change on our side fixes that. Business Central does hold both the photo path and
// the full description, but neither is published anywhere we can read, and Evo-soft development
// time is not available.
//
// Running in the browser ON the site is the site talking to itself: same origin, nothing blocked,
// no third party, Jordan's own data. Same approach the Auto Clerk already uses for the Saleroom
// relay.
//
// ⚠ It writes FILES rather than posting to the Hub. Posting would mean opening a write endpoint to
// the internet with its own token and cross-origin rules; a file needs none of that, can be looked
// at before it is loaded, and picks up where it left off.
//
// ⚠ Each file is capped well under Railway's 20 MB body limit — past that the proxy truncates the
// upload silently, which would look like a partial sale rather than a failure.

export const COLLECTOR_FILE_MB = 12

export function bcCollectorScript(opts: { from: number; to: number }): string {
  const { from, to } = opts
  return `/* Vectis Hub — collect Business Central lots from the website.
   Run this ON www.vectis.co.uk with the console open. It saves files to your Downloads;
   upload them on the Hub's BC Database page when it finishes. Safe to re-run. */
(async () => {
  const FROM = ${from};          // first sale id on the website to look at
  const TO   = ${to};            // last one
  const MB   = ${COLLECTOR_FILE_MB};   // a new file is saved each time it reaches this size
  const PER  = 500, PAUSE = 250, GIVE_UP_AFTER = 80;

  const KEY = "vectisHubCollect";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "null") } catch { return null } })();
  let at = saved && saved.to === TO && saved.next > FROM ? saved.next : FROM;
  if (at > FROM) console.log("%cCarrying on from sale " + at, "color:#2AB4A6");

  const isBc = u => !!u && /^r\\d+-\\d+$/i.test(String(u).trim());
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let part = 1, sales = [], lots = 0, bytes = 0, misses = 0, stopped = false;
  window.vectisStop = () => { stopped = true; console.log("Stopping after this sale…") };

  function save() {
    if (!sales.length) return;
    const blob = new Blob([JSON.stringify({ collectedAt: new Date().toISOString(), sales })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vectis-bc-lots-" + String(part).padStart(2, "0") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    console.log("%cSaved " + a.download + " — " + lots.toLocaleString() + " lots so far", "color:#2AB4A6;font-weight:bold");
    part++; sales = []; bytes = 0;
  }

  async function feed(saleId, page) {
    const body = new URLSearchParams({
      per_page: String(PER), current_page: String(page), auction_id: String(saleId),
      lot_order: "", sale_type: "", keyword: "", cate_arr: "[]", sub_cate_arr: "[]",
      extended_attrs_obj: "{}", low_estimate: "", high_estimate: "", catalogue_layout_header_id: "0",
    });
    const res = await fetch("/index.php?option=com_bidding&format=json&task=commission.getLots", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      body,
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text) return null;
    try { const j = JSON.parse(text); return Array.isArray(j.lots) ? j : null } catch { return null }
  }

  console.log("%cCollecting Business Central lots, sales " + at + " to " + TO + ". Type vectisStop() to stop.", "color:#2AB4A6;font-weight:bold");

  for (; at <= TO && !stopped; at++) {
    let all = [], total = 0;
    for (let page = 1; page <= 40; page++) {
      const j = await feed(at, page);
      if (!j) break;
      total = Number(j.total_lots) || 0;
      all.push(...j.lots);
      if (j.lots.length < PER || all.length >= total) break;
      await sleep(PAUSE);
    }
    if (!all.length) {
      if (++misses >= GIVE_UP_AFTER) { console.log("Nothing for " + GIVE_UP_AFTER + " sales in a row — stopping at " + at); break }
      await sleep(PAUSE); continue;
    }
    misses = 0;

    // Only lots whose id looks like a Business Central one (R008728-194). Everything else is an
    // ABC lot and already in the Hub from the spreadsheet — leave it alone.
    const keep = all.filter(l => isBc(l.unique_id)).map(l => ({
      unique_id: l.unique_id, lot_number: l.lot_number, description: l.description,
      id: l.id, sef_link: l.sef_link, image: l.image,
      hammer_price: l.hammer_price, sold: l.sold,
    }));
    if (keep.length) {
      const m = String(all[0] && all[0].sef_link || "").match(/^bidding\\/([A-Za-z]\\d+)-/);
      const row = { siteId: at, auctionCode: m ? m[1].toUpperCase() : null, lots: keep };
      sales.push(row); lots += keep.length; bytes += JSON.stringify(row).length;
      console.log("sale " + at + " · " + (row.auctionCode || "?") + " · " + keep.length + " BC lots");
      if (bytes > MB * 1024 * 1024) save();
    }
    localStorage.setItem(KEY, JSON.stringify({ next: at + 1, to: TO }));
    await sleep(PAUSE);
  }

  save();
  localStorage.setItem(KEY, JSON.stringify({ next: at, to: TO }));
  console.log("%cDone — " + lots.toLocaleString() + " lots in " + (part - 1) + " file(s). Upload them on the Hub's BC Database page.", "color:#2AB4A6;font-weight:bold");
  if (at <= TO) console.log("Not finished — run it again and it will carry on from sale " + at + ".");
})();`
}
