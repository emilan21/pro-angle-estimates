import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import type { EstimateSnapshot } from "../src/domain/contracts";
import { fullExportZip } from "../src/documents/backup";
import { csvCell, estimateCsv } from "../src/documents/csv";
import { estimateHtml } from "../src/documents/pdf";
import { estimateXlsx } from "../src/documents/xlsx";

const fixture: EstimateSnapshot = { estimateId:"id",displayId:"EST-J-2026-0001-v01",version:1,generatedAt:"2026-09-13T12:00:00.000Z",customer:{displayId:"C-0001",name:"Doe, Jane",email:"jane@example.com",phone:null,address:"1 Main St"},job:{displayId:"J-2026-0001",name:"Deck",address:"1 Main St",scope:"Rebuild deck"},lines:[{id:"line",catalogItemId:null,position:0,description:'Board, 2"',details:"Long\ndescription",skuOrModel:"ABC",unit:"each",quantity:2,unitPriceCents:856,amountCents:1712}],adjustments:[],totals:{subtotalCents:1712,markupCents:0,discountCents:0,taxCents:0,totalCents:1712,depositCents:0,balanceDueCents:1712},notes:null };
describe("documents",()=>{
  it("quotes RFC 4180 fields",()=>expect(csvCell('a,"b"\n')).toBe('"a,""b""\n"'));
  it("exports one CSV row per line",()=>{const csv=estimateCsv(fixture);expect(csv).toContain('"Doe, Jane"');expect(csv.split("\r\n")).toHaveLength(3)});
  it("creates two valid XLSX worksheet entries",()=>{const zip=unzipSync(estimateXlsx(fixture));expect(Object.keys(zip)).toContain("xl/worksheets/sheet2.xml");expect(strFromU8(zip["xl/workbook.xml"])).toContain("Estimate Summary")});
  it("keeps totals with the final item block and complete branded artwork",()=>{const html=estimateHtml(fixture);expect(html).toContain('src="data:image/jpeg;base64,');expect(html).toContain('<span class="brand-fix">CONSTRUCTION</span>');expect(html).not.toContain(">CONTRACTING<");expect(html).toContain("188 Kaider Road");expect(html).toContain("440.429.3474");expect(html).toContain("break-inside:avoid")});
  it("exports manifest and relational tables",()=>{const zip=unzipSync(fullExportZip([{name:"customers",rows:[{id:"1"}]}],"2026-09-13T00:00:00Z"));expect(JSON.parse(strFromU8(zip["manifest.json"])).tables[0].records).toBe(1);expect(strFromU8(zip["customers.csv"])).toContain("id")});
});
