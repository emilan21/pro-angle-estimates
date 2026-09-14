import { strToU8, zipSync } from "fflate";
import type { EstimateSnapshot } from "../domain/contracts";

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (index: number) => { let result = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result; return result; };

function worksheet(rows: (string | number)[][]): string {
  const data = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => typeof value === "number" ? `<c r="${col(c)}${r + 1}" t="n"><v>${value}</v></c>` : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`;
}

export function estimateXlsx(snapshot: EstimateSnapshot): Uint8Array {
  const summary: (string | number)[][] = [["Pro Angle Construction Estimate", snapshot.displayId], ["Generated", snapshot.generatedAt], ["Customer", snapshot.customer.name], ["Customer ID", snapshot.customer.displayId], ["Job", snapshot.job.name], ["Job ID", snapshot.job.displayId], ["Subtotal (cents)", snapshot.totals.subtotalCents], ["Total (cents)", snapshot.totals.totalCents], ["Deposit (cents)", snapshot.totals.depositCents], ["Balance due (cents)", snapshot.totals.balanceDueCents]];
  const lines: (string | number)[][] = [["Position", "Description", "Details", "SKU / Model", "Quantity", "Unit", "Unit Price (cents)", "Amount (cents)"], ...snapshot.lines.map((line) => [line.position, line.description, line.details ?? "", line.skuOrModel ?? "", line.quantity, line.unit, line.unitPriceCents, line.amountCents])];
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estimate Summary" sheetId="1" r:id="rId1"/><sheet name="Line Items" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheet(summary)), "xl/worksheets/sheet2.xml": strToU8(worksheet(lines))
  };
  return zipSync(files, { level: 6 });
}
