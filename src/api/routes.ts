import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { calculateEstimate, lineAmountCents } from "../domain/calculations";
import { catalogInput, catalogWithOfferInput, customerInput, estimateGenerationInput, jobInput, lineItemInput, retailerOfferInput, type AdjustmentInput, type EstimateSnapshot } from "../domain/contracts";
import { safeArtifactFilename } from "../domain/ids";
import { artifacts, catalogItems, customers, estimates, jobLineItems, jobs, priceHistory, retailerOffers } from "../db/schema";
import { fullExportZip } from "../documents/backup";
import { estimateCsv } from "../documents/csv";
import { estimateHtml } from "../documents/pdf";
import { estimateXlsx } from "../documents/xlsx";
import { apiError, auditStatement, now, sha256Hex } from "./helpers";

type AppBindings = { Bindings: Env; Variables: { actorEmail: string } };
export const api = new Hono<AppBindings>();
const idParam = z.object({ id: z.uuid() });
const jobLineParam = z.object({ jobId: z.uuid(), id: z.uuid() });

api.get("/health", (c) => c.json({ ok: true, version: "v1" }));

api.get("/dashboard", async (c) => {
  const statements = ["SELECT COUNT(*) AS count FROM customers", "SELECT COUNT(*) AS count FROM jobs WHERE status = 'draft'", "SELECT COUNT(*) AS count FROM estimates", "SELECT COALESCE(SUM(total_cents), 0) AS count FROM estimates WHERE generated_at >= datetime('now', '-30 days')"].map((sql) => c.env.DB.prepare(sql));
  const [customerCount, openJobs, estimateCount, monthTotal] = await c.env.DB.batch<{ count: number }>(statements);
  const recent = await c.env.DB.prepare("SELECT e.id, e.display_id AS displayId, e.generated_at AS generatedAt, e.total_cents AS totalCents, json_extract(e.customer_snapshot_json, '$.name') AS customerName, json_extract(e.job_snapshot_json, '$.name') AS jobName FROM estimates e ORDER BY e.generated_at DESC LIMIT 6").all();
  return c.json({ counts: { customers: customerCount.results[0]?.count ?? 0, openJobs: openJobs.results[0]?.count ?? 0, estimates: estimateCount.results[0]?.count ?? 0, monthTotalCents: monthTotal.results[0]?.count ?? 0 }, recent: recent.results });
});

api.get("/customers", async (c) => c.json({ data: await drizzle(c.env.DB).select().from(customers).orderBy(desc(customers.createdAt)).all() }));
api.post("/customers", zValidator("json", customerInput), async (c) => {
  const input = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  const insert = c.env.DB.prepare("INSERT INTO customers(id, display_id, name, email, phone, address, notes, created_at, updated_at) SELECT ?, printf('C-%04d', next_value), ?, ?, ?, ?, ?, ?, ? FROM counters WHERE scope = 'customer'").bind(id, input.name, input.email || null, input.phone || null, input.address || null, input.notes || null, timestamp, timestamp);
  await c.env.DB.batch([insert, c.env.DB.prepare("UPDATE counters SET next_value = next_value + 1, updated_at = ? WHERE scope = 'customer'").bind(timestamp), auditStatement(c.env.DB, actor, "create", "customer", id)]);
  return c.json({ data: await drizzle(c.env.DB).select().from(customers).where(eq(customers.id, id)).get() }, 201);
});
api.patch("/customers/:id", zValidator("param", idParam), zValidator("json", customerInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), actor = c.get("actorEmail"), timestamp = now();
  const updated = await drizzle(c.env.DB).update(customers).set({ name: input.name, email: input.email || null, phone: input.phone || null, address: input.address || null, notes: input.notes || null, updatedAt: timestamp }).where(eq(customers.id, id)).returning().get();
  if (!updated) return apiError(c, 404, "NOT_FOUND", "Customer not found.");
  await auditStatement(c.env.DB, actor, "update", "customer", id).run();
  return c.json({ data: updated });
});

api.get("/jobs", async (c) => {
  const rows = await c.env.DB.prepare("SELECT j.*, c.name AS customer_name, c.display_id AS customer_display_id FROM jobs j JOIN customers c ON c.id = j.customer_id ORDER BY j.created_at DESC").all();
  return c.json({ data: rows.results });
});
api.post("/jobs", zValidator("json", jobInput), async (c) => {
  const input = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), year = new Date().getFullYear(), scope = `job:${year}`, actor = c.get("actorEmail");
  const counter = c.env.DB.prepare("INSERT INTO counters(scope, next_value, updated_at) VALUES (?, 1, ?) ON CONFLICT(scope) DO NOTHING").bind(scope, timestamp);
  const insert = c.env.DB.prepare("INSERT INTO jobs(id, display_id, customer_id, name, address, scope, notes, status, created_at, updated_at) SELECT ?, printf('J-%d-%04d', ?, next_value), ?, ?, ?, ?, ?, 'draft', ?, ? FROM counters WHERE scope = ?").bind(id, year, input.customerId, input.name, input.address || null, input.scope || null, input.notes || null, timestamp, timestamp, scope);
  try { await c.env.DB.batch([counter, insert, c.env.DB.prepare("UPDATE counters SET next_value = next_value + 1, updated_at = ? WHERE scope = ?").bind(timestamp, scope), auditStatement(c.env.DB, actor, "create", "job", id)]); }
  catch { return apiError(c, 422, "INVALID_CUSTOMER", "The selected customer does not exist."); }
  return c.json({ data: await drizzle(c.env.DB).select().from(jobs).where(eq(jobs.id, id)).get() }, 201);
});

api.get("/jobs/:id/line-items", zValidator("param", idParam), async (c) => c.json({ data: await drizzle(c.env.DB).select().from(jobLineItems).where(eq(jobLineItems.jobId, c.req.valid("param").id)).orderBy(jobLineItems.position).all() }));
api.post("/jobs/:id/line-items", zValidator("param", idParam), zValidator("json", lineItemInput), async (c) => {
  const jobId = c.req.valid("param").id, input = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  try { await c.env.DB.batch([c.env.DB.prepare("INSERT INTO job_line_items(id, job_id, catalog_item_id, position, description, details, sku_or_model, unit, quantity, unit_price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, jobId, input.catalogItemId ?? null, input.position, input.description, input.details ?? null, input.skuOrModel ?? null, input.unit, input.quantity, input.unitPriceCents, timestamp, timestamp), auditStatement(c.env.DB, actor, "create", "job_line_item", id, { jobId })]); }
  catch { return apiError(c, 409, "LINE_ITEM_CONFLICT", "The job or line position is invalid."); }
  return c.json({ data: await drizzle(c.env.DB).select().from(jobLineItems).where(eq(jobLineItems.id, id)).get() }, 201);
});
api.patch("/jobs/:jobId/line-items/:id", zValidator("param", jobLineParam), zValidator("json", lineItemInput), async (c) => {
  const { id, jobId } = c.req.valid("param"), input = c.req.valid("json"), actor = c.get("actorEmail"), timestamp = now();
  const updated = await drizzle(c.env.DB).update(jobLineItems).set({ catalogItemId: input.catalogItemId ?? null, position: input.position, description: input.description, details: input.details ?? null, skuOrModel: input.skuOrModel ?? null, unit: input.unit, quantity: input.quantity, unitPriceCents: input.unitPriceCents, updatedAt: timestamp }).where(and(eq(jobLineItems.id, id), eq(jobLineItems.jobId, jobId))).returning().get();
  if (!updated) return apiError(c, 404, "NOT_FOUND", "Line item not found.");
  await auditStatement(c.env.DB, actor, "update", "job_line_item", id, { jobId }).run();
  return c.json({ data: updated });
});
api.delete("/jobs/:jobId/line-items/:id", zValidator("param", jobLineParam), async (c) => {
  const { id, jobId } = c.req.valid("param"), actor = c.get("actorEmail");
  const result = await drizzle(c.env.DB).delete(jobLineItems).where(and(eq(jobLineItems.id, id), eq(jobLineItems.jobId, jobId))).returning().get();
  if (!result) return apiError(c, 404, "NOT_FOUND", "Line item not found.");
  await auditStatement(c.env.DB, actor, "delete", "job_line_item", id, { jobId }).run(); return c.body(null, 204);
});

api.get("/catalog", async (c) => c.json({ data: await drizzle(c.env.DB).select().from(catalogItems).orderBy(desc(catalogItems.createdAt)).all() }));
api.post("/catalog", zValidator("json", catalogWithOfferInput), async (c) => {
  const { retailerOffer, ...input } = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO catalog_items(id, description, unit, default_price_cents, active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, input.description, input.unit, input.defaultPriceCents, input.active ? 1 : 0, input.notes ?? null, timestamp, timestamp),
    auditStatement(c.env.DB, actor, "create", "catalog_item", id)
  ];
  if (retailerOffer) {
    const offerId = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare("INSERT INTO retailer_offers(id, catalog_item_id, retailer, sku, model_or_upc, product_url, store_context, observed_price_cents, observed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(offerId, id, retailerOffer.retailer, retailerOffer.sku ?? null, retailerOffer.modelOrUpc ?? null, retailerOffer.productUrl || null, retailerOffer.storeContext ?? null, retailerOffer.observedPriceCents, retailerOffer.observedAt, timestamp, timestamp),
      c.env.DB.prepare("INSERT INTO price_history(id, retailer_offer_id, price_cents, observed_at, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)").bind(crypto.randomUUID(), offerId, retailerOffer.observedPriceCents, retailerOffer.observedAt, timestamp),
      auditStatement(c.env.DB, actor, "create", "retailer_offer", offerId, { catalogItemId: id })
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ data: await drizzle(c.env.DB).select().from(catalogItems).where(eq(catalogItems.id, id)).get() }, 201);
});
api.patch("/catalog/:id", zValidator("param", idParam), zValidator("json", catalogInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), actor = c.get("actorEmail"), timestamp = now();
  const updated = await drizzle(c.env.DB).update(catalogItems).set({ ...input, notes: input.notes || null, updatedAt: timestamp }).where(eq(catalogItems.id, id)).returning().get();
  if (!updated) return apiError(c, 404, "NOT_FOUND", "Catalog item not found.");
  await auditStatement(c.env.DB, actor, "update", "catalog_item", id).run();
  return c.json({ data: updated });
});
api.get("/catalog/:id/retailer-offers", zValidator("param", idParam), async (c) => c.json({ data: await drizzle(c.env.DB).select().from(retailerOffers).where(eq(retailerOffers.catalogItemId, c.req.valid("param").id)).orderBy(desc(retailerOffers.observedAt)).all() }));
api.post("/retailer-offers", zValidator("json", retailerOfferInput), async (c) => {
  const input = c.req.valid("json"), id = crypto.randomUUID(), historyId = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  try { await c.env.DB.batch([c.env.DB.prepare("INSERT INTO retailer_offers(id, catalog_item_id, retailer, sku, model_or_upc, product_url, store_context, observed_price_cents, observed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, input.catalogItemId, input.retailer, input.sku ?? null, input.modelOrUpc ?? null, input.productUrl || null, input.storeContext ?? null, input.observedPriceCents, input.observedAt, timestamp, timestamp), c.env.DB.prepare("INSERT INTO price_history(id, retailer_offer_id, price_cents, observed_at, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)").bind(historyId, id, input.observedPriceCents, input.observedAt, timestamp), auditStatement(c.env.DB, actor, "create", "retailer_offer", id)]); }
  catch { return apiError(c, 409, "OFFER_CONFLICT", "That retailer offer already exists."); }
  return c.json({ data: await drizzle(c.env.DB).select().from(retailerOffers).where(eq(retailerOffers.id, id)).get() }, 201);
});
api.patch("/retailer-offers/:id", zValidator("param", idParam), zValidator("json", retailerOfferInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), actor = c.get("actorEmail"), timestamp = now();
  const current = await drizzle(c.env.DB).select().from(retailerOffers).where(eq(retailerOffers.id, id)).get();
  if (!current) return apiError(c, 404, "NOT_FOUND", "Retailer offer not found.");
  if (current.catalogItemId !== input.catalogItemId) return apiError(c, 422, "CATALOG_MISMATCH", "A retailer offer cannot be moved to another catalog item.");
  const updated = await drizzle(c.env.DB).update(retailerOffers).set({ retailer: input.retailer, sku: input.sku || null, modelOrUpc: input.modelOrUpc || null, productUrl: input.productUrl || null, storeContext: input.storeContext || null, observedPriceCents: input.observedPriceCents, observedAt: input.observedAt, updatedAt: timestamp }).where(eq(retailerOffers.id, id)).returning().get();
  if (current.observedPriceCents !== input.observedPriceCents || current.observedAt !== input.observedAt) await drizzle(c.env.DB).insert(priceHistory).values({ id: crypto.randomUUID(), retailerOfferId: id, priceCents: input.observedPriceCents, observedAt: input.observedAt, source: "manual", createdAt: timestamp }).run();
  await auditStatement(c.env.DB, actor, "update", "retailer_offer", id, { catalogItemId: input.catalogItemId }).run();
  return c.json({ data: updated });
});

api.get("/estimates", async (c) => {
  const [estimateRows, artifactRows] = await Promise.all([
    drizzle(c.env.DB).select().from(estimates).orderBy(desc(estimates.generatedAt)).all(),
    drizzle(c.env.DB).select({ id: artifacts.id, estimateId: artifacts.estimateId, format: artifacts.format, filename: artifacts.filename, status: artifacts.status }).from(artifacts).all()
  ]);
  const artifactsByEstimate = new Map<string, typeof artifactRows>();
  for (const artifact of artifactRows) artifactsByEstimate.set(artifact.estimateId, [...(artifactsByEstimate.get(artifact.estimateId) ?? []), artifact]);
  return c.json({ data: estimateRows.map((estimate) => ({ ...estimate, artifacts: artifactsByEstimate.get(estimate.id) ?? [] })) });
});
api.post("/jobs/:id/estimates", zValidator("param", idParam), zValidator("json", estimateGenerationInput), async (c) => {
  const jobId = c.req.valid("param").id, input = c.req.valid("json"), actor = c.get("actorEmail"), timestamp = now(), estimateId = crypto.randomUUID();
  const jobResult = await c.env.DB.prepare("SELECT j.*, c.display_id AS customer_display_id, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address AS customer_address FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?").bind(jobId).first<Record<string, string | null>>();
  if (!jobResult) return apiError(c, 404, "NOT_FOUND", "Job not found.");
  const lines = await drizzle(c.env.DB).select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)).orderBy(jobLineItems.position).all();
  if (!lines.length) return apiError(c, 422, "NO_LINE_ITEMS", "Add at least one line item before generating an estimate.");
  const totals = calculateEstimate(lines, input.adjustments);
  const customerSnapshot = { displayId: jobResult.customer_display_id!, name: jobResult.customer_name!, email: jobResult.customer_email, phone: jobResult.customer_phone, address: jobResult.customer_address };
  const jobSnapshot = { displayId: jobResult.display_id!, name: jobResult.name!, address: jobResult.address, scope: jobResult.scope };
  const amountByKind: Record<AdjustmentInput["kind"], number> = { markup: totals.markupCents, discount: totals.discountCents, tax: totals.taxCents, deposit: totals.depositCents };
  const insertEstimate = c.env.DB.prepare("INSERT INTO estimates(id, job_id, display_id, version, customer_snapshot_json, job_snapshot_json, notes, subtotal_cents, total_cents, deposit_cents, balance_due_cents, generated_at, generated_by) SELECT ?, ?, 'EST-' || j.display_id || '-v' || printf('%02d', COALESCE(MAX(e.version), 0) + 1), COALESCE(MAX(e.version), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM jobs j LEFT JOIN estimates e ON e.job_id = j.id WHERE j.id = ? GROUP BY j.id").bind(estimateId, jobId, JSON.stringify(customerSnapshot), JSON.stringify(jobSnapshot), input.notes ?? null, totals.subtotalCents, totals.totalCents, totals.depositCents, totals.balanceDueCents, timestamp, actor, jobId);
  const statements: D1PreparedStatement[] = [insertEstimate, ...lines.map((line) => c.env.DB.prepare("INSERT INTO estimate_line_items(id, estimate_id, source_line_item_id, position, description, details, sku_or_model, unit, quantity, unit_price_cents, amount_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), estimateId, line.id, line.position, line.description, line.details, line.skuOrModel, line.unit, line.quantity, line.unitPriceCents, lineAmountCents(line.quantity, line.unitPriceCents))), ...input.adjustments.map((a) => c.env.DB.prepare("INSERT INTO estimate_adjustments(estimate_id, kind, mode, value, amount_cents) VALUES (?, ?, ?, ?, ?)").bind(estimateId, a.kind, a.mode, a.value, amountByKind[a.kind])), auditStatement(c.env.DB, actor, "generate", "estimate", estimateId, { jobId })];
  try { await c.env.DB.batch(statements); } catch (error) { console.error(JSON.stringify({ message: "estimate snapshot failed", jobId, error: error instanceof Error ? error.message : "unknown" })); return apiError(c, 409, "VERSION_CONFLICT", "Estimate generation conflicted with another request. Retry generation."); }
  const created = await drizzle(c.env.DB).select().from(estimates).where(eq(estimates.id, estimateId)).get(); if (!created) return apiError(c, 500, "GENERATION_FAILED", "Estimate could not be read after generation.");
  const snapshot: EstimateSnapshot = { estimateId, displayId: created.displayId, version: created.version, generatedAt: created.generatedAt, customer: customerSnapshot, job: jobSnapshot, lines: lines.map((line) => ({ ...line, catalogItemId: line.catalogItemId, details: line.details, skuOrModel: line.skuOrModel, amountCents: lineAmountCents(line.quantity, line.unitPriceCents) })), adjustments: input.adjustments, totals, notes: input.notes ?? null };
  const generated = await generateArtifacts(c.env, snapshot);
  return c.json({ data: { ...created, artifacts: generated } }, 201);
});

api.get("/artifacts/:id/download", zValidator("param", idParam), async (c) => {
  const artifact = await drizzle(c.env.DB).select().from(artifacts).where(eq(artifacts.id, c.req.valid("param").id)).get();
  if (!artifact || artifact.status !== "ready") return apiError(c, 404, "NOT_FOUND", "Artifact is not available.");
  const object = await c.env.ARTIFACTS.get(artifact.objectKey); if (!object) return apiError(c, 404, "OBJECT_MISSING", "Stored artifact is missing.");
  const headers = new Headers({ "Content-Type": artifact.contentType, "Content-Disposition": `attachment; filename="${artifact.filename.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  return new Response(object.body, { headers });
});

api.get("/export", async (c) => {
  const tableNames = ["customers", "jobs", "job_line_items", "catalog_items", "retailer_offers", "price_history", "estimates", "estimate_line_items", "estimate_adjustments"];
  const tables = await Promise.all(tableNames.map(async (name) => ({ name: name === "job_line_items" ? "line_items" : name === "catalog_items" ? "catalog" : name, rows: (await c.env.DB.prepare(`SELECT * FROM ${name}`).all()).results as Record<string, unknown>[] })));
  const data = fullExportZip(tables); return new Response(data as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="pro-angle-full-export-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "private, no-store" } });
});

async function generateArtifacts(env: Env, snapshot: EstimateSnapshot) {
  const outputs: Array<{ format: "csv" | "xlsx" | "pdf"; data?: Uint8Array; contentType: string; error?: string }> = [
    { format: "csv", data: new TextEncoder().encode(estimateCsv(snapshot)), contentType: "text/csv; charset=utf-8" },
    { format: "xlsx", data: estimateXlsx(snapshot), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  ];
  try { const response = await env.BROWSER.quickAction("pdf", { html: estimateHtml(snapshot), pdfOptions: { format: "letter", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } } }); if (!response.ok) throw new Error(`Browser Run returned ${response.status}`); outputs.push({ format: "pdf", data: new Uint8Array(await response.arrayBuffer()), contentType: "application/pdf" }); }
  catch (error) { outputs.push({ format: "pdf", contentType: "application/pdf", error: error instanceof Error ? error.message : "PDF generation failed" }); }
  const result = [];
  for (const output of outputs) {
    const id = crypto.randomUUID(), filename = safeArtifactFilename(snapshot.displayId, snapshot.customer.name, output.format), key = `estimates/${snapshot.job.displayId}/${snapshot.displayId}/${filename}`, createdAt = now();
    if (output.data) { const checksum = await sha256Hex(output.data); await env.ARTIFACTS.put(key, output.data, { httpMetadata: { contentType: output.contentType }, customMetadata: { checksum, estimateId: snapshot.estimateId } }); await env.DB.prepare("INSERT INTO artifacts(id, estimate_id, format, object_key, filename, content_type, size_bytes, checksum_sha256, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)").bind(id, snapshot.estimateId, output.format, key, filename, output.contentType, output.data.byteLength, checksum, createdAt).run(); result.push({ id, format: output.format, filename, status: "ready" }); }
    else { await env.DB.prepare("INSERT INTO artifacts(id, estimate_id, format, object_key, filename, content_type, status, failure_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?)").bind(id, snapshot.estimateId, output.format, key, filename, output.contentType, output.error, createdAt).run(); result.push({ id, format: output.format, filename, status: "failed" }); }
  }
  return result;
}
