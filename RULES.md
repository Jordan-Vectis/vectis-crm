# Vectis App — Standing Rules & Design Decisions

These rules capture deliberate decisions made about how the app works.
Before making any change, check it doesn't contradict something here.

---

## General

- This is **not a CRM**. It is "the app". Never call it a CRM in UI copy, logs, or comments.
- The business is **Vectis auction house** — all language and logic should reflect an auction context.

---

## Lots & Identifiers

- **Unique IDs** (format: `R000016-413` — a letter, digits, a dash, more digits) must be stored in
  the `receiptUniqueId` field, **never** in `lotNumber`.
- **Barcodes** match either `F066001` (letter + 6–7 digits) or the unique ID format above.
- **Lot titles** are capped at **83 characters** (truncate with `…` if exceeded).
- A lot with a `receiptUniqueId` is considered identified even if `lotNumber` is empty — don't treat
  an empty `lotNumber` as unidentified.

---

## Batch AI Run

- **Lots must never be silently failed or skipped due to transient errors.**
  The retry loop is infinite — keep retrying until the lot succeeds or the user explicitly cancels.
  Only abort a lot early on a Gemini **content block** (those will never succeed on retry).
- **Rate limit backoff** is exponential: 60s → 120s → 240s → 480s → … capped at 30 minutes.
  On each retry, alternate between the primary model and the fallback model so that if one is still
  rate-limited the other gets a chance.
- **Inter-lot delay** is 12 seconds (gives Gemini rate limits room to breathe).
- The batch API returns HTTP 200 even when a lot fails inside — always inspect `results[0].status`,
  not just `res.ok`, to determine whether a lot succeeded.
- **Description formatting**: preserve newlines from Gemini's response. Join lines with `\n`, never
  with a space — collapsing to one paragraph destroys list formatting.

---

## Description Copier

- Default sort order is **Unique ID**, then Barcode, then Lot Number (user-selectable).
- The `Folder` field sent from the cataloguing page must be `receiptUniqueId || lotNumber` — never
  just `lotNumber`, because lots created via "Apply to Auction" have an empty `lotNumber`.
- All three identifiers (Receipt Unique ID, Barcode, Lot Number) should always be included in the
  data sent to the copier so the sort and display work correctly regardless of which mode is active.

---

## Photo Upload / Matching

- "Match by Filename" mode parses filenames like `R000016-413_1.jpg` — strip the extension, then
  strip the trailing `_N` suffix to get the lot identifier.
- Both barcode formats must be accepted by `isVectisBarcode`.

---

## Gemini / AI

- Check `promptFeedback.blockReason` **and** `candidates[0].finishReason` before calling
  `.text()` — calling `.text()` on a blocked response throws and loses the block reason.
- Rate-limit errors from the Gemini SDK (429 / RESOURCE_EXHAUSTED) must be prefixed with
  `RATE_LIMITED:` when re-thrown so the frontend can apply the correct backoff.
- `503 Service Unavailable` from Gemini is transient — retry, do not surface as permanent failure.
