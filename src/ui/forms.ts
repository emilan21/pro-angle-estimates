import type { CatalogInput } from "../domain/contracts";

export function catalogFormPayload(values: Record<string, string>): CatalogInput {
  const { defaultPrice, description = "", unit = "" } = values;
  return {
    description,
    unit,
    defaultPriceCents: Math.round(Number(defaultPrice) * 100),
    active: true,
    notes: null,
  };
}
