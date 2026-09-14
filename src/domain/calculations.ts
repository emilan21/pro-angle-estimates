import type { AdjustmentInput, EstimateTotals, LineItemInput } from "./contracts";

export function lineAmountCents(quantity: number, unitPriceCents: number): number {
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(unitPriceCents) || unitPriceCents < 0) throw new Error("Invalid line item amount");
  return Math.round(quantity * unitPriceCents);
}

function adjustmentAmount(baseCents: number, adjustment: AdjustmentInput | undefined): number {
  if (!adjustment) return 0;
  return adjustment.mode === "fixed" ? adjustment.value : Math.round((baseCents * adjustment.value) / 10_000);
}

export function calculateEstimate(lines: Pick<LineItemInput, "quantity" | "unitPriceCents">[], adjustments: AdjustmentInput[]): EstimateTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + lineAmountCents(line.quantity, line.unitPriceCents), 0);
  const byKind = new Map(adjustments.map((adjustment) => [adjustment.kind, adjustment]));
  const markupCents = adjustmentAmount(subtotalCents, byKind.get("markup"));
  const afterMarkup = subtotalCents + markupCents;
  const discountCents = Math.min(afterMarkup, adjustmentAmount(afterMarkup, byKind.get("discount")));
  const taxableCents = afterMarkup - discountCents;
  const taxCents = adjustmentAmount(taxableCents, byKind.get("tax"));
  const totalCents = taxableCents + taxCents;
  const depositCents = Math.min(totalCents, adjustmentAmount(totalCents, byKind.get("deposit")));
  return { subtotalCents, markupCents, discountCents, taxCents, totalCents, depositCents, balanceDueCents: totalCents - depositCents };
}

export function calculateEstimateCharges(lines: Array<{ amountCents: number }>, adjustments: AdjustmentInput[]): EstimateTotals {
  return calculateEstimate(lines.map((line) => ({ quantity: 1, unitPriceCents: line.amountCents })), adjustments);
}

export function formatMoney(valueCents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(valueCents / 100);
}
