import { strToU8, zipSync } from "fflate";
import { csvCell } from "./csv";

export type ExportTable = { name: string; rows: Record<string, unknown>[] };

export function fullExportZip(tables: ExportTable[], exportedAt = new Date().toISOString()): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const table of tables) {
    const columns = [...new Set(table.rows.flatMap((row) => Object.keys(row)))];
    const content = [columns, ...table.rows.map((row) => columns.map((column) => row[column]))].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    files[`${table.name}.csv`] = strToU8(`\uFEFF${content}`);
  }
  files["manifest.json"] = strToU8(JSON.stringify({ schemaVersion: 2, exportedAt, format: "RFC 4180 CSV", tables: tables.map((table) => ({ name: table.name, records: table.rows.length })), relationships: { jobs: "customer_id -> customers.id", line_items: "job_id -> jobs.id", job_materials: "job_id -> jobs.id; catalog_item_id -> catalog.id (optional)", retailer_offers: "catalog_item_id -> catalog.id", price_history: "retailer_offer_id -> retailer_offers.id", estimate_drafts: "job_id -> jobs.id; source_estimate_id -> estimates.id (optional)", estimate_draft_charges: "draft_id -> estimate_drafts.id", estimate_draft_adjustments: "draft_id -> estimate_drafts.id", estimates: "job_id -> jobs.id", estimate_line_items: "estimate_id -> estimates.id", estimate_adjustments: "estimate_id -> estimates.id" } }, null, 2));
  return zipSync(files, { level: 6 });
}

export type FriendlyCustomer = { id: string; displayId: string; name: string; jobs: Array<{ id: string; displayId: string; name: string; files: Array<{ name: string; data: Uint8Array; entityId: string; displayId: string }> }> };

export function safePathSegment(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "untitled";
}

export async function customerExportZip(customers: FriendlyCustomer[], exportedAt = new Date().toISOString()): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const manifestFiles: Array<{ customerId: string; jobId: string; entityId: string; displayId: string; path: string; checksumSha256: string; sizeBytes: number }> = [];
  for (const customer of customers) for (const job of customer.jobs) for (const file of job.files) {
    const path = `customers/${safePathSegment(customer.name)}_${customer.displayId.toLowerCase().replace(/-/g, "_")}/${safePathSegment(job.name)}_${job.displayId.toLowerCase().replace(/-/g, "_")}/${file.name}`;
    files[path] = file.data;
    const bytes = file.data.slice();
    const hash = await crypto.subtle.digest("SHA-256", bytes.buffer);
    manifestFiles.push({ customerId: customer.id, jobId: job.id, entityId: file.entityId, displayId: file.displayId, path, checksumSha256: [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join(""), sizeBytes: file.data.byteLength });
  }
  files["manifest.json"] = strToU8(JSON.stringify({ schemaVersion: 1, exportedAt, customers: customers.map((customer) => ({ id: customer.id, displayId: customer.displayId, path: `customers/${safePathSegment(customer.name)}_${customer.displayId.toLowerCase().replace(/-/g, "_")}`, jobs: customer.jobs.map((job) => ({ id: job.id, displayId: job.displayId, name: job.name })) })), files: manifestFiles }, null, 2));
  return zipSync(files, { level: 6 });
}
