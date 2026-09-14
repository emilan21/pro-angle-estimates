import { describe, expect, it } from "vitest";
import { calculateEstimate, lineAmountCents } from "../src/domain/calculations";
import { customerDisplayId, estimateDisplayId, jobDisplayId, safeArtifactFilename } from "../src/domain/ids";
import { likelySameProduct, normalizeRetailerIdentity } from "../src/domain/retailers";

describe("estimate domain", () => {
  it("allocates stable display identifiers", () => { expect(customerDisplayId(1)).toBe("C-0001"); expect(jobDisplayId(2026,1)).toBe("J-2026-0001"); expect(estimateDisplayId("J-2026-0001",1)).toBe("EST-J-2026-0001-v01"); });
  it("rounds fractional quantities to cents", () => expect(lineAmountCents(1.5, 333)).toBe(500));
  it("applies markup, discount, tax, deposit in order", () => expect(calculateEstimate([{quantity:2,unitPriceCents:1000}],[{kind:"markup",mode:"percent",value:1000},{kind:"discount",mode:"fixed",value:200},{kind:"tax",mode:"percent",value:600},{kind:"deposit",mode:"percent",value:5000}])).toEqual({subtotalCents:2000,markupCents:200,discountCents:200,taxCents:120,totalCents:2120,depositCents:1060,balanceDueCents:1060}));
  it("omits blank adjustments by producing subtotal equals total", () => { const total=calculateEstimate([{quantity:3,unitPriceCents:125}],[]); expect(total.totalCents).toBe(375); expect(total.depositCents).toBe(0); });
  it("normalizes retailer identities and protects filenames", () => { expect(normalizeRetailerIdentity(" Lowe's #123 ")).toBe("lowe s 123"); expect(likelySameProduct({retailer:"A",modelOrUpc:"ABC-12345"},{retailer:"B",modelOrUpc:"abc 12345"})).toBe(true); expect(safeArtifactFilename("EST-J-2026-0001-v01","A/B Customer","pdf")).toBe("EST-J-2026-0001-v01_A_B_Customer.pdf"); });
});
