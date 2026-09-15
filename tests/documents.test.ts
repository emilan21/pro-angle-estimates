import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import type { EstimateSnapshot } from "../src/domain/contracts";
import { customerExportZip, fullExportZip, safePathSegment } from "../src/documents/backup";
import { csvCell, estimateCsv, materialsCsv } from "../src/documents/csv";
import { estimateHtml } from "../src/documents/pdf";
import { estimateXlsx, materialsXlsx } from "../src/documents/xlsx";

const fixture: EstimateSnapshot = { estimateId:"id",displayId:"EST-J-2026-0001-v01",version:1,generatedAt:"2026-09-13T12:00:00.000Z",customer:{displayId:"C-0001",name:"Doe, Jane",email:"jane@example.com",phone:null,address:"1 Main St"},job:{displayId:"J-2026-0001",name:"Deck",address:"1 Main St",scope:"Rebuild deck"},lines:[{id:"line",catalogItemId:null,position:0,description:'Board, 2"',details:"Long\ndescription",skuOrModel:"ABC",unit:"each",quantity:2,unitPriceCents:856,amountCents:1712}],adjustments:[],totals:{subtotalCents:1712,markupCents:0,discountCents:0,taxCents:0,totalCents:1712,depositCents:0,balanceDueCents:1712},notes:null };
describe("documents",()=>{
  it("quotes RFC 4180 fields",()=>expect(csvCell('a,"b"\n')).toBe('"a,""b""\n"'));
  it("neutralizes spreadsheet formulas in user text without changing numbers",()=>{
    for (const value of ["=1+1", "+1+1", "-1+1", "@SUM(A1:A2)", "\t=1+1"]) expect(csvCell(value)).toBe(`'${value}`);
    expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
    expect(csvCell(-100)).toBe("-100");
  });
  it("exports one CSV row per line",()=>{const csv=estimateCsv(fixture);expect(csv).toContain('"Doe, Jane"');expect(csv.split("\r\n")).toHaveLength(3)});
  it("creates two valid XLSX worksheet entries",()=>{const zip=unzipSync(estimateXlsx(fixture));expect(Object.keys(zip)).toContain("xl/worksheets/sheet2.xml");expect(strFromU8(zip["xl/workbook.xml"])).toContain("Estimate Summary")});
  it("keeps totals with the final item block and logo-only uncropped artwork",()=>{const html=estimateHtml(fixture);expect(html).toContain('src="data:image/jpeg;base64,');expect(html).toContain('<div class="header-artwork">');expect(html).toContain('<img src=');expect(html).toContain('alt="Pro Angle Construction"');expect(html).toContain('<span class="brand-fix">CONSTRUCTION</span>');expect(html).toContain(".page-header img{display:block;width:100%;height:auto}");expect(html).not.toContain("object-fit:cover");expect(html).not.toContain("class=\"byline\"");expect(html).not.toContain(">CONTRACTING<");expect(html).toContain("bottom:.78in");expect(html).toContain("188 Kaider Road");expect(html).toContain("440.429.3474");expect(html).toContain("break-inside:avoid")});
  it("repeats the logo header and footer on every manual PDF page",()=>{const html=estimateHtml({...fixture,lines:Array.from({length:15},(_,position)=>({...fixture.lines[0],id:`line-${position}`,position}))});expect(html.match(/class="page-header"/g)).toHaveLength(3);expect(html.match(/class="page-footer"/g)).toHaveLength(3);expect(html.match(/class="contact"/g)).toHaveLength(1)});
  it("exports manifest and relational tables",()=>{const zip=unzipSync(fullExportZip([{name:"customers",rows:[{id:"1"}]}],"2026-09-13T00:00:00Z"));expect(JSON.parse(strFromU8(zip["manifest.json"])).tables[0].records).toBe(1);expect(strFromU8(zip["customers.csv"])).toContain("id")});
  it("exports independent job materials as CSV and two-sheet XLSX",()=>{const rows=[{position:0,description:"Deck board",quantity:12,unit:"each",unitCostCents:null,retailer:null,skuOrModel:null,productUrl:null,notes:null}];expect(materialsCsv({displayId:"J-2026-0001",name:"New Deck"},rows)).toContain("Deck board");expect(Object.keys(unzipSync(materialsXlsx({displayId:"J-2026-0001",name:"New Deck"},rows)))).toContain("xl/worksheets/sheet2.xml")});
  it("creates sanitized customer folders with checksummed manifest entries",async()=>{expect(safePathSegment(" Éric / Milan ")).toBe("eric_milan");const zip=unzipSync(await customerExportZip([{id:"customer-uuid",displayId:"C-0001",name:"Eric Milan",jobs:[{id:"job-uuid",displayId:"J-2026-0001",name:"New Deck",files:[{name:"materials.csv",data:new Uint8Array([1,2,3]),entityId:"job-uuid",displayId:"J-2026-0001"}]}]}],"2026-09-14T00:00:00Z"));const path="customers/eric_milan_c_0001/new_deck_j_2026_0001/materials.csv";expect(zip[path]).toBeTruthy();expect(JSON.parse(strFromU8(zip["manifest.json"])).files[0]).toMatchObject({entityId:"job-uuid",displayId:"J-2026-0001",path,sizeBytes:3})});
});
