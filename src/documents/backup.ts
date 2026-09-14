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
  files["manifest.json"] = strToU8(JSON.stringify({ schemaVersion: 1, exportedAt, format: "RFC 4180 CSV", tables: tables.map((table) => ({ name: table.name, records: table.rows.length })), relationships: { jobs: "customer_id -> customers.id", line_items: "job_id -> jobs.id", retailer_offers: "catalog_item_id -> catalog.id", price_history: "retailer_offer_id -> retailer_offers.id", estimates: "job_id -> jobs.id", estimate_adjustments: "estimate_id -> estimates.id" } }, null, 2));
  return zipSync(files, { level: 6 });
}
