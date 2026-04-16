import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

const COMPANY = {
  name: "Vectis Auctions",
  address: "Fleck Way, Thornaby, Stockton-on-Tees, TS17 9JZ",
  tel: "01642 750616",
  email: "admin@vectis.co.uk",
  web: "www.vectis.co.uk",
}

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const receiptId = req.nextUrl.searchParams.get("receiptId")
    if (!receiptId) return NextResponse.json({ error: "receiptId required" }, { status: 400 })

    const receipt = await prisma.warehouseReceipt.findUnique({
      where: { id: receiptId },
      include: { contact: true, containers: { orderBy: { createdAt: "asc" } } },
    })
    if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const c = receipt.contact
    const date = receipt.createdAt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
    const commPct = receipt.commissionRate > 0 ? `${receipt.commissionRate}%` : "To be agreed"

    const containerRows = receipt.containers.map(ct => `
      <tr>
        <td>${esc(ct.id)}</td>
        <td>${esc(ct.description)}</td>
      </tr>`).join("")

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Receipt ${receiptId}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; padding: 20mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 10px; }
  .company-name { font-size: 18pt; font-weight: bold; letter-spacing: 1px; }
  .company-details { font-size: 8pt; color: #444; margin-top: 2px; }
  .doc-title { font-size: 14pt; font-weight: bold; text-align: right; }
  .doc-ref { font-size: 9pt; text-align: right; color: #444; margin-top: 4px; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; background: #f0f0f0; padding: 3px 6px; border: 1px solid #ccc; margin-bottom: 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
  .field label { font-size: 8pt; color: #555; display: block; }
  .field span { font-size: 9pt; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { background: #222; color: #fff; font-size: 8.5pt; padding: 4px 6px; text-align: left; }
  td { font-size: 9pt; padding: 4px 6px; border-bottom: 1px solid #ddd; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .notes-box { border: 1px solid #ccc; padding: 8px; min-height: 40px; font-size: 9pt; background: #fafafa; }
  .terms { font-size: 7.5pt; color: #444; line-height: 1.4; border-top: 1px solid #ccc; padding-top: 8px; }
  .bank-box { border: 1px solid #000; padding: 8px; margin-top: 10px; }
  .bank-box p { font-size: 8.5pt; margin-bottom: 6px; }
  .bank-row { display: flex; gap: 20px; margin-top: 6px; }
  .bank-field { flex: 1; border-bottom: 1px solid #000; padding-bottom: 2px; font-size: 9pt; min-height: 18px; }
  .bank-label { font-size: 7.5pt; color: #555; }
  @media print { body { padding: 10mm 15mm; } }
</style>
</head>
<body onload="window.print()">

<div class="header">
  <div>
    <div class="company-name">${COMPANY.name.toUpperCase()}</div>
    <div class="company-details">${COMPANY.address}</div>
    <div class="company-details">Tel: ${COMPANY.tel} &nbsp;|&nbsp; ${COMPANY.email} &nbsp;|&nbsp; ${COMPANY.web}</div>
  </div>
  <div>
    <div class="doc-title">RECEIPT – Confirmation</div>
    <div class="doc-ref">Receipt No: <strong>${esc(receiptId.toUpperCase())}</strong></div>
    <div class="doc-ref">Date: <strong>${date}</strong></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Vendor Details</div>
  <div class="grid">
    <div class="field"><label>Vendor Name</label><span>${esc(c.name)}</span></div>
    <div class="field"><label>Vendor No.</label><span>${esc(c.id)}</span></div>
    ${c.email ? `<div class="field"><label>Email</label><span>${esc(c.email)}</span></div>` : ""}
    ${c.phone ? `<div class="field"><label>Phone</label><span>${esc(c.phone)}</span></div>` : ""}
    ${c.addressLine1 ? `<div class="field" style="grid-column:1/-1"><label>Address</label><span>${esc([c.addressLine1, c.addressLine2, c.postcode].filter(Boolean).join(", "))}</span></div>` : ""}
    <div class="field"><label>Commission Rate</label><span>${commPct}</span></div>
    <div class="field"><label>Status</label><span style="text-transform:capitalize">${esc(receipt.status)}</span></div>
  </div>
</div>

${receipt.containers.length > 0 ? `
<div class="section">
  <div class="section-title">Items / Totes Received (${receipt.containers.length})</div>
  <table>
    <thead><tr><th>Tote / Container ID</th><th>Description</th></tr></thead>
    <tbody>${containerRows || '<tr><td colspan="2" style="color:#999">No containers on record</td></tr>'}</tbody>
  </table>
</div>` : ""}

${receipt.notes ? `
<div class="section">
  <div class="section-title">Notes</div>
  <div class="notes-box">${esc(receipt.notes)}</div>
</div>` : ""}

<div class="section">
  <div class="section-title">Reserve Instructions</div>
  <p style="font-size:9pt;line-height:1.5">Unless otherwise agreed in writing, reserves are set at <strong>60% of the bottom estimate</strong>. Lots that fail to reach their reserve will not be sold. If you wish to set specific reserves, please notify us in writing before the sale date.</p>
</div>

<div class="terms">
  <strong>Terms &amp; Conditions of Consignment:</strong> Vectis Auctions acts as agent for the vendor. The vendor warrants that they are the legal owner of the items consigned or are authorised to sell them. Vectis Auctions reserves the right to withdraw any lot from sale. All items are insured at 50% of the lower estimate whilst on our premises. Commission and applicable VAT will be deducted from the hammer price achieved. Payment will be made within 25 working days of the sale date, subject to receipt of cleared funds from the buyer.
</div>

<div class="bank-box">
  <p><strong>Please provide your bank details for payment:</strong></p>
  <div class="bank-row">
    <div><div class="bank-label">Account Name</div><div class="bank-field">&nbsp;</div></div>
    <div><div class="bank-label">Sort Code</div><div class="bank-field">&nbsp;</div></div>
    <div><div class="bank-label">Account Number</div><div class="bank-field">&nbsp;</div></div>
  </div>
  <div class="bank-row" style="margin-top:10px">
    <div style="flex:2"><div class="bank-label">Signature</div><div class="bank-field">&nbsp;</div></div>
    <div style="flex:1"><div class="bank-label">Date</div><div class="bank-field">&nbsp;</div></div>
  </div>
</div>

</body>
</html>`

    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

function esc(s: string | null | undefined): string {
  if (!s) return ""
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
