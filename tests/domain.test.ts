import { describe, expect, it } from "vitest";
import { calculateEstimate, lineAmountCents } from "../src/domain/calculations";
import { customerDisplayId, estimateDisplayId, jobDisplayId, safeArtifactFilename } from "../src/domain/ids";
import { likelySameProduct, normalizeRetailerIdentity } from "../src/domain/retailers";
import { catalogFormPayload, catalogWithOfferFormPayload, jobLineFormPayload, retailerOfferFormPayload } from "../src/ui/forms";
import { accessIdentityFromUnknown } from "../src/ui/api";
import { clearWorkspaceInput, retailerOfferInput } from "../src/domain/contracts";

describe("estimate domain", () => {
  it("allocates stable display identifiers", () => { expect(customerDisplayId(1)).toBe("C-0001"); expect(jobDisplayId(2026,1)).toBe("J-2026-0001"); expect(estimateDisplayId("J-2026-0001",1)).toBe("EST-J-2026-0001-v01"); });
  it("rounds fractional quantities to cents", () => expect(lineAmountCents(1.5, 333)).toBe(500));
  it("applies markup, discount, tax, deposit in order", () => expect(calculateEstimate([{quantity:2,unitPriceCents:1000}],[{kind:"markup",mode:"percent",value:1000},{kind:"discount",mode:"fixed",value:200},{kind:"tax",mode:"percent",value:600},{kind:"deposit",mode:"percent",value:5000}])).toEqual({subtotalCents:2000,markupCents:200,discountCents:200,taxCents:120,totalCents:2120,depositCents:1060,balanceDueCents:1060}));
  it("omits blank adjustments by producing subtotal equals total", () => { const total=calculateEstimate([{quantity:3,unitPriceCents:125}],[]); expect(total.totalCents).toBe(375); expect(total.depositCents).toBe(0); });
  it("normalizes retailer identities and protects filenames", () => { expect(normalizeRetailerIdentity(" Lowe's #123 ")).toBe("lowe s 123"); expect(likelySameProduct({retailer:"A",modelOrUpc:"ABC-12345"},{retailer:"B",modelOrUpc:"abc 12345"})).toBe(true); expect(safeArtifactFilename("EST-J-2026-0001-v01","A/B Customer","pdf")).toBe("EST-J-2026-0001-v01_A_B_Customer.pdf"); });
  it("maps catalog form values to the strict cents API contract", () => expect(catalogFormPayload({ description: "2x4 stud", unit: "each", defaultPrice: "4.98", notes: "Kiln dried", active: "on" })).toEqual({ description: "2x4 stud", unit: "each", defaultPriceCents: 498, active: true, notes: "Kiln dried" }));
  it("creates a catalog item and initial retailer offer in one payload", () => expect(catalogWithOfferFormPayload({ description: "2x4 stud", unit: "each", defaultPrice: "4.98", active: "on", retailer: "Lowe's", sku: "123", modelOrUpc: "ABC", productUrl: "https://www.lowes.com/pd/example/123", storeContext: "15401", observedPrice: "4.78", observedAt: "2026-09-14T12:00Z" })).toEqual({ description: "2x4 stud", unit: "each", defaultPriceCents: 498, active: true, notes: null, retailerOffer: { retailer: "Lowe's", sku: "123", modelOrUpc: "ABC", productUrl: "https://www.lowes.com/pd/example/123", storeContext: "15401", observedPriceCents: 478, observedAt: "2026-09-14T12:00:00.000Z" } }));
  it("maps retailer offer form values and omits blank references", () => expect(retailerOfferFormPayload({ retailer: "Lowe's", sku: "", modelOrUpc: "ABC-123", productUrl: "", storeContext: "15401", observedPrice: "4.78", observedAt: "2026-09-14T12:00Z" }, "catalog-id")).toEqual({ catalogItemId: "catalog-id", retailer: "Lowe's", sku: null, modelOrUpc: "ABC-123", productUrl: null, storeContext: "15401", observedPriceCents: 478, observedAt: "2026-09-14T12:00:00.000Z" }));
  it("accepts only HTTPS retailer product URLs", () => {
    const offer = { catalogItemId: "01991f0e-e123-7000-8000-000000000001", retailer: "Lowe's", sku: null, modelOrUpc: null, storeContext: null, observedPriceCents: 478, observedAt: "2026-09-14T12:00:00.000Z" };
    expect(retailerOfferInput.safeParse({ ...offer, productUrl: "https://www.lowes.com/pd/example" }).success).toBe(true);
    expect(retailerOfferInput.safeParse({ ...offer, productUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(retailerOfferInput.safeParse({ ...offer, productUrl: "http://www.lowes.com/pd/example" }).success).toBe(false);
  });
  it("maps editable job line values without changing their source position", () => expect(jobLineFormPayload({ description: "2x4 stud", details: "Wall framing", skuOrModel: "ABC-123", unit: "each", quantity: "100", unitPrice: "5.10" }, { catalogItemId: "catalog-id", position: 2 })).toEqual({ catalogItemId: "catalog-id", position: 2, description: "2x4 stud", details: "Wall framing", skuOrModel: "ABC-123", unit: "each", quantity: 100, unitPriceCents: 510 }));
  it("uses the authenticated profile name with a safe email fallback", () => {
    expect(accessIdentityFromUnknown({ name: "Eric Milan", email: "emilan@ericmilan.dev" })).toEqual({ name: "Eric Milan", email: "emilan@ericmilan.dev" });
    expect(accessIdentityFromUnknown({ email: "eprogram1@gmail.com" })).toEqual({ name: "eprogram1", email: "eprogram1@gmail.com" });
  });
  it("requires the exact destructive workspace confirmation phrase", () => {
    expect(clearWorkspaceInput.safeParse({ confirmation: "CLEAR ALL DATA" }).success).toBe(true);
    expect(clearWorkspaceInput.safeParse({ confirmation: "clear all data" }).success).toBe(false);
    expect(clearWorkspaceInput.safeParse({ confirmation: "CLEAR ALL DATA", force: true }).success).toBe(false);
  });
});
