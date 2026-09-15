import { formatMoney } from "../domain/calculations";
import type { AdjustmentInput, EstimateSnapshot } from "../domain/contracts";
import estimateHeader from "./assets/estimate-logo.jpg?inline";

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const label = (kind: AdjustmentInput["kind"]) => ({ markup: "Markup", discount: "Discount", tax: "Tax", deposit: "Deposit" })[kind];

function paginate(lines: EstimateSnapshot["lines"]): EstimateSnapshot["lines"][] {
  const pages: EstimateSnapshot["lines"][] = [[]];
  let weight = 0, limit = 5;
  for (const line of lines) {
    const lineWeight = 1 + Math.floor(((line.description?.length ?? 0) + (line.details?.length ?? 0)) / 110);
    if (pages.at(-1)!.length && weight + lineWeight > limit) { pages.push([]); weight = 0; limit = 9; }
    pages.at(-1)!.push(line); weight += lineWeight;
  }
  return pages;
}

export function estimateHtml(s: EstimateSnapshot): string {
  const date = new Date(s.generatedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" });
  const adjustments = s.adjustments.map((item) => {
    const cents = item.kind === "markup" ? s.totals.markupCents : item.kind === "discount" ? -s.totals.discountCents : item.kind === "tax" ? s.totals.taxCents : -s.totals.depositCents;
    return `<div><span>${label(item.kind)}</span><strong>${formatMoney(cents)}</strong></div>`;
  }).join("");
  const totals = `<section class="final-block"><div class="totals"><div><span>Subtotal</span><strong>${formatMoney(s.totals.subtotalCents)}</strong></div>${adjustments}<div class="grand"><strong>TOTAL</strong><strong>${formatMoney(s.totals.totalCents)}</strong></div>${s.totals.depositCents ? `<div><span>Balance due</span><strong>${formatMoney(s.totals.balanceDueCents)}</strong></div>` : ""}</div></section>`;
  const notes = s.notes ? `<section class="notes"><h2>ESTIMATE NOTES</h2><p>${esc(s.notes)}</p></section>` : "";
  const header = `<div class="page-header"><div class="header-artwork"><img src="${estimateHeader}" alt="Pro Angle Construction"><span class="brand-fix">CONSTRUCTION</span></div></div>`;
  const footer = `<footer class="page-footer"><strong>BUILDING A STRONGER TOMORROW</strong><br>RESIDENTIAL &nbsp;|&nbsp; COMMERCIAL &nbsp;|&nbsp; RENOVATIONS &nbsp;|&nbsp; ADDITIONS &nbsp;|&nbsp; GENERAL CONTRACTING</footer>`;
  const chargeTable = (lines: EstimateSnapshot["lines"], continued: boolean) => `<section class="costs"><h2>ESTIMATED COST${continued ? " - CONTINUED" : ""}</h2><table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${lines.map((line) => `<tr><td><strong>${esc(line.description)}</strong>${line.details ? `<small>${esc(line.details)}</small>` : ""}</td><td>${formatMoney(line.amountCents)}</td></tr>`).join("")}</tbody></table></section>`;
  const pages = paginate(s.lines);
  const body = pages.map((lines, index) => {
    const first = index === 0, last = index === pages.length - 1;
    const intro = first ? `<section class="title"><h1>${esc(s.job.name)} Estimate</h1><p>${esc(s.displayId)} &nbsp;•&nbsp; ${esc(date)}</p></section><section class="summary"><div class="card"><h2>CUSTOMER</h2><p>${esc(s.customer.name)}
${esc(s.customer.email)}${s.customer.phone ? `\n${esc(s.customer.phone)}` : ""}
${esc(s.customer.address)}</p></div><div class="card"><h2>ESTIMATE SUMMARY</h2><p>Estimate: ${esc(s.displayId)}
Date: ${esc(date)}
Customer ID: ${esc(s.customer.displayId)}</p></div></section><section class="project"><h2>PROJECT DETAILS</h2><table><tbody><tr><th>Job ID</th><td>${esc(s.job.displayId)}</td><th>Job name</th><td>${esc(s.job.name)}</td></tr><tr><th>Address</th><td colspan="3">${esc(s.job.address)}</td></tr><tr><th>Scope</th><td colspan="3">${esc(s.job.scope)}</td></tr></tbody></table></section>` : "";
    return `<section class="page">${header}<main>${intro}${chargeTable(lines, !first)}${last ? `${totals}${notes}<section class="contact"><h2>CONTACT</h2><p><strong>Pro Angle Construction</strong> · Kevin Edinger</p><p>188 Kaider Road, Uniontown, PA 15401 · 440.429.3474 · proangleconstruction@gmail.com</p></section>` : ""}</main>${footer}</section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:Letter;margin:0}*{box-sizing:border-box}html,body{margin:0;color:#142f45;font-family:Arial,sans-serif;font-size:10.5px}.page{width:8.5in;height:10.99in;position:relative;padding:.25in .58in .8in;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid;overflow:hidden}.page+.page{break-before:page;page-break-before:always}.page:last-child{break-after:auto;page-break-after:auto}.page-header{text-align:center;padding-bottom:.13in}.header-artwork{position:relative;width:58%;margin:0 auto}.page-header img{display:block;width:100%;height:auto}.brand-fix{position:absolute;left:23%;top:69%;width:61%;height:13%;display:flex;align-items:center;justify-content:center;background:#fff;color:#17334a;font-size:10px;letter-spacing:4px}.page-footer{position:absolute;left:.58in;right:.58in;bottom:.25in;height:.43in;background:#0b2f49;color:#fff;text-align:center;padding:7px;font-size:7px;letter-spacing:1.7px;line-height:1.55}.page-footer strong{font-size:8px;letter-spacing:2.6px}main{padding:.08in 0 .12in}.title{text-align:center;break-inside:avoid;margin:0 0 18px}.title h1{font-size:23px;letter-spacing:.6px;margin:0 0 6px;text-transform:uppercase}.title p{margin:0;color:#53616c}.summary{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;break-inside:avoid}.card{border:1px solid #ccd9e2;padding:9px 11px;min-height:74px}.card h2,.project h2,.costs h2,.notes h2,.contact h2{font-size:11px;letter-spacing:.8px;margin:0 0 6px}.card p,.notes p{white-space:pre-line;color:#1d252a;line-height:1.4;margin:0}.project{margin-bottom:18px;break-inside:avoid}.project table,.costs table{border-collapse:collapse;width:100%}.project th{width:22%;background:#e8eff4;text-align:left}.project th,.project td{border:1px solid #ccd9e2;padding:7px;vertical-align:top}.project td{white-space:pre-line;color:#1d252a}.costs h2{font-size:13px}.costs thead{display:table-header-group}.costs th{background:#16374f;color:#fff;letter-spacing:.5px;text-align:left;padding:8px}.costs th:last-child,.costs td:last-child{text-align:right;width:26%}.costs td{border:1px solid #d5e0e7;padding:8px;vertical-align:top}.costs tbody tr{break-inside:avoid}.costs tbody tr:nth-child(even){background:#f4f7f9}.costs td small{display:block;white-space:pre-line;color:#53616c;font-weight:400;line-height:1.35;margin-top:4px}.final-block{break-inside:avoid;margin-left:auto;width:48%;padding-top:12px}.totals div{display:flex;justify-content:space-between;padding:4px 7px;color:#1d252a}.totals .grand{border-top:2px solid #16374f;color:#16374f;font-size:14px;padding-top:7px}.notes{break-inside:avoid;margin-top:16px}.contact{position:absolute;left:.58in;right:.58in;bottom:.78in;border-top:1px solid #ccd9e2;padding-top:9px;text-align:center;color:#334b5d}.contact p{margin:2px}.contact strong{color:#142f45}
  </style></head><body>${body}</body></html>`;
}
