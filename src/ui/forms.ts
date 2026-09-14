import type { CatalogInput } from "../domain/contracts";

export function catalogFormPayload(values: Record<string, string>): CatalogInput {
  const { defaultPrice, description = "", unit = "", notes = "", active } = values;
  return {
    description,
    unit,
    defaultPriceCents: Math.round(Number(defaultPrice) * 100),
    active: active === "on",
    notes: notes.trim() || null,
  };
}

export function catalogWithOfferFormPayload(values: Record<string, string>) {
  const catalog = catalogFormPayload(values);
  const hasRetailerOffer = ["retailer", "sku", "modelOrUpc", "productUrl", "storeContext", "observedPrice"].some((field) => values[field]?.trim());
  return {
    ...catalog,
    retailerOffer: hasRetailerOffer ? {
      retailer: values.retailer?.trim() ?? "",
      sku: values.sku?.trim() || null,
      modelOrUpc: values.modelOrUpc?.trim() || null,
      productUrl: values.productUrl?.trim() || null,
      storeContext: values.storeContext?.trim() || null,
      observedPriceCents: Math.round(Number(values.observedPrice) * 100),
      observedAt: values.observedAt ? new Date(values.observedAt).toISOString() : new Date().toISOString(),
    } : null,
  };
}

export function retailerOfferFormPayload(values: Record<string, string>, catalogItemId: string) {
  const observedAt = values.observedAt ? new Date(values.observedAt).toISOString() : new Date().toISOString();
  return {
    catalogItemId,
    retailer: values.retailer ?? "",
    sku: values.sku?.trim() || null,
    modelOrUpc: values.modelOrUpc?.trim() || null,
    productUrl: values.productUrl?.trim() || null,
    storeContext: values.storeContext?.trim() || null,
    observedPriceCents: Math.round(Number(values.observedPrice) * 100),
    observedAt,
  };
}

export function jobLineFormPayload(values: Record<string, string>, source: { catalogItemId: string | null; position: number }) {
  return {
    ...source,
    description: values.description ?? "",
    details: values.details?.trim() || null,
    skuOrModel: values.skuOrModel?.trim() || null,
    unit: values.unit ?? "",
    quantity: Number(values.quantity),
    unitPriceCents: Math.round(Number(values.unitPrice) * 100),
  };
}

export function dateTimeLocalValue(value = new Date().toISOString()): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
