import type { EstimateSnapshot } from "../domain/contracts";

export function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  // Spreadsheet applications can execute formula-like user text when a CSV is opened.
  const text = typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function estimateCsv(snapshot: EstimateSnapshot): string {
  const headers = ["estimate_id", "version", "generated_at", "customer_id", "customer_name", "customer_email", "customer_phone", "customer_address", "job_id", "job_name", "job_address", "job_scope", "position", "description", "details", "amount_cents", "subtotal_cents", "markup_cents", "discount_cents", "tax_cents", "total_cents", "deposit_cents", "balance_due_cents", "estimate_notes"];
  const rows = snapshot.lines.map((line) => [snapshot.displayId, snapshot.version, snapshot.generatedAt, snapshot.customer.displayId, snapshot.customer.name, snapshot.customer.email, snapshot.customer.phone, snapshot.customer.address, snapshot.job.displayId, snapshot.job.name, snapshot.job.address, snapshot.job.scope, line.position, line.description, line.details, line.amountCents, snapshot.totals.subtotalCents, snapshot.totals.markupCents, snapshot.totals.discountCents, snapshot.totals.taxCents, snapshot.totals.totalCents, snapshot.totals.depositCents, snapshot.totals.balanceDueCents, snapshot.notes]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function materialsCsv(job: { displayId: string; name: string }, rows: Array<{ position: number; description: string; quantity: number; unit: string; unitCostCents: number | null; retailer: string | null; skuOrModel: string | null; productUrl: string | null; notes: string | null }>): string {
  const headers = ["job_id", "job_name", "position", "description", "quantity", "unit", "unit_cost_cents", "retailer", "sku_model", "url", "notes"];
  return `\uFEFF${[headers, ...rows.map((row) => [job.displayId, job.name, row.position, row.description, row.quantity, row.unit, row.unitCostCents, row.retailer, row.skuOrModel, row.productUrl, row.notes])].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
