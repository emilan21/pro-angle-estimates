import type { EstimateSnapshot } from "../domain/contracts";

export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function estimateCsv(snapshot: EstimateSnapshot): string {
  const headers = ["estimate_id", "version", "generated_at", "customer_id", "customer_name", "job_id", "job_name", "position", "description", "details", "sku_model", "quantity", "unit", "unit_price_cents", "amount_cents", "subtotal_cents", "total_cents", "deposit_cents", "balance_due_cents"];
  const rows = snapshot.lines.map((line) => [snapshot.displayId, snapshot.version, snapshot.generatedAt, snapshot.customer.displayId, snapshot.customer.name, snapshot.job.displayId, snapshot.job.name, line.position, line.description, line.details, line.skuOrModel, line.quantity, line.unit, line.unitPriceCents, line.amountCents, snapshot.totals.subtotalCents, snapshot.totals.totalCents, snapshot.totals.depositCents, snapshot.totals.balanceDueCents]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
