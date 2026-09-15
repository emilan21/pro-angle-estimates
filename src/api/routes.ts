import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { calculateEstimate, calculateEstimateCharges, lineAmountCents } from "../domain/calculations";
import { artifactRetryInput, catalogInput, catalogWithOfferInput, clearWorkspaceInput, customerAddressInput, customerInput, draftChargeInput, draftMetadataInput, draftOrderInput, estimateGenerationInput, jobInput, lineItemInput, materialInput, retailerOfferInput, type AdjustmentInput, type EstimateSnapshot } from "../domain/contracts";
import { safeArtifactFilename } from "../domain/ids";
import { artifacts, catalogItems, customerAddresses, customers, estimates, jobLineItems, jobMaterials, jobs, priceHistory, retailerOffers } from "../db/schema";
import { customerExportZip, fullExportZip, type FriendlyCustomer } from "../documents/backup";
import { estimateCsv, materialsCsv } from "../documents/csv";
import { estimateHtml } from "../documents/pdf";
import { estimateXlsx, materialsXlsx, type MaterialExportRow } from "../documents/xlsx";
import { apiError, auditStatement, now, sha256Hex } from "./helpers";

type AppBindings = { Bindings: Env; Variables: { actorEmail: string } };
export const api = new Hono<AppBindings>();
const idParam = z.object({ id: z.uuid() });
const jobLineParam = z.object({ jobId: z.uuid(), id: z.uuid() });
const draftChargeParam = z.object({ id: z.uuid(), chargeId: z.uuid() });
const customerAddressParam = z.object({ customerId: z.uuid(), id: z.uuid() });

api.get("/health", (c) => c.json({ ok: true, version: "v1" }));

api.get("/dashboard", async (c) => {
  const statements = ["SELECT COUNT(*) AS count FROM customers", "SELECT COUNT(*) AS count FROM jobs WHERE status = 'draft'", "SELECT COUNT(*) AS count FROM estimates", "SELECT COALESCE(SUM(total_cents), 0) AS count FROM estimates WHERE generated_at >= datetime('now', '-30 days')"].map((sql) => c.env.DB.prepare(sql));
  const [customerCount, openJobs, estimateCount, monthTotal] = await c.env.DB.batch<{ count: number }>(statements);
  const recent = await c.env.DB.prepare("SELECT e.id, e.display_id AS displayId, e.generated_at AS generatedAt, e.total_cents AS totalCents, json_extract(e.customer_snapshot_json, '$.name') AS customerName, json_extract(e.job_snapshot_json, '$.name') AS jobName FROM estimates e ORDER BY e.generated_at DESC LIMIT 6").all();
  return c.json({ counts: { customers: customerCount.results[0]?.count ?? 0, openJobs: openJobs.results[0]?.count ?? 0, estimates: estimateCount.results[0]?.count ?? 0, monthTotalCents: monthTotal.results[0]?.count ?? 0 }, recent: recent.results });
});

api.get("/customers", async (c) => {
  const [customerRows, addressRows] = await Promise.all([drizzle(c.env.DB).select().from(customers).orderBy(desc(customers.createdAt)).all(), drizzle(c.env.DB).select().from(customerAddresses).orderBy(desc(customerAddresses.isDefault), customerAddresses.createdAt).all()]);
  return c.json({ data: customerRows.map((customer) => ({ ...customer, addresses: addressRows.filter((address) => address.customerId === customer.id) })) });
});
api.post("/customers", zValidator("json", customerInput), async (c) => {
  const input = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  const insert = c.env.DB.prepare("INSERT INTO customers(id, display_id, name, email, phone, address, notes, created_at, updated_at) SELECT ?, printf('C-%04d', next_value), ?, ?, ?, ?, ?, ?, ? FROM counters WHERE scope = 'customer'").bind(id, input.name, input.email || null, input.phone || null, input.address || null, input.notes || null, timestamp, timestamp);
  const statements = [insert, c.env.DB.prepare("UPDATE counters SET next_value = next_value + 1, updated_at = ? WHERE scope = 'customer'").bind(timestamp)];
  if (input.address) statements.push(c.env.DB.prepare("INSERT INTO customer_addresses(id, customer_id, label, address, is_default, created_at, updated_at) VALUES (?, ?, 'Default', ?, 1, ?, ?)").bind(crypto.randomUUID(), id, input.address, timestamp, timestamp));
  statements.push(auditStatement(c.env.DB, actor, "create", "customer", id));
  await c.env.DB.batch(statements);
  return c.json({ data: await drizzle(c.env.DB).select().from(customers).where(eq(customers.id, id)).get() }, 201);
});
api.patch("/customers/:id", zValidator("param", idParam), zValidator("json", customerInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), actor = c.get("actorEmail"), timestamp = now();
  const existing = await drizzle(c.env.DB).select().from(customers).where(eq(customers.id, id)).get();
  if (!existing) return apiError(c, 404, "NOT_FOUND", "Customer not found.");
  const updated = await drizzle(c.env.DB).update(customers).set({ name: input.name, email: input.email || null, phone: input.phone || null, address: input.address === undefined ? existing.address : input.address || null, notes: input.notes || null, updatedAt: timestamp }).where(eq(customers.id, id)).returning().get();
  if (!updated) return apiError(c, 404, "NOT_FOUND", "Customer not found.");
  await auditStatement(c.env.DB, actor, "update", "customer", id).run();
  return c.json({ data: updated });
});
api.get("/customers/:id/addresses", zValidator("param", idParam), async (c) => c.json({ data: await drizzle(c.env.DB).select().from(customerAddresses).where(eq(customerAddresses.customerId, c.req.valid("param").id)).orderBy(desc(customerAddresses.isDefault), customerAddresses.createdAt).all() }));
api.post("/customers/:id/addresses", zValidator("param", idParam), zValidator("json", customerAddressInput), async (c) => {
  const customerId = c.req.valid("param").id, input = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  const customer = await drizzle(c.env.DB).select().from(customers).where(eq(customers.id, customerId)).get();
  if (!customer) return apiError(c, 404, "NOT_FOUND", "Customer not found.");
  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM customer_addresses WHERE customer_id = ?").bind(customerId).first<{ count: number }>();
  const isDefault = input.isDefault || !existing?.count;
  const statements = [];
  if (isDefault) statements.push(c.env.DB.prepare("UPDATE customer_addresses SET is_default = 0, updated_at = ? WHERE customer_id = ?").bind(timestamp, customerId));
  statements.push(c.env.DB.prepare("INSERT INTO customer_addresses(id, customer_id, label, address, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, customerId, input.label, input.address, isDefault ? 1 : 0, timestamp, timestamp));
  if (isDefault) statements.push(c.env.DB.prepare("UPDATE customers SET address = ?, updated_at = ? WHERE id = ?").bind(input.address, timestamp, customerId));
  statements.push(auditStatement(c.env.DB, actor, "create", "customer_address", id, { customerId, isDefault }));
  await c.env.DB.batch(statements); return c.json({ data: await drizzle(c.env.DB).select().from(customerAddresses).where(eq(customerAddresses.id, id)).get() }, 201);
});
api.patch("/customers/:customerId/addresses/:id", zValidator("param", customerAddressParam), zValidator("json", customerAddressInput), async (c) => {
  const { customerId, id } = c.req.valid("param"), input = c.req.valid("json"), timestamp = now(), actor = c.get("actorEmail");
  const current = await drizzle(c.env.DB).select().from(customerAddresses).where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId))).get();
  if (!current) return apiError(c, 404, "NOT_FOUND", "Customer address not found.");
  if (current.isDefault && !input.isDefault) return apiError(c, 422, "DEFAULT_REQUIRED", "Choose another default address before changing this one.");
  const statements = [];
  if (input.isDefault) statements.push(c.env.DB.prepare("UPDATE customer_addresses SET is_default = 0, updated_at = ? WHERE customer_id = ? AND id <> ?").bind(timestamp, customerId, id));
  statements.push(c.env.DB.prepare("UPDATE customer_addresses SET label = ?, address = ?, is_default = ?, updated_at = ? WHERE id = ? AND customer_id = ?").bind(input.label, input.address, input.isDefault ? 1 : 0, timestamp, id, customerId));
  if (input.isDefault) statements.push(c.env.DB.prepare("UPDATE customers SET address = ?, updated_at = ? WHERE id = ?").bind(input.address, timestamp, customerId));
  statements.push(auditStatement(c.env.DB, actor, "update", "customer_address", id, { customerId, isDefault: input.isDefault }));
  await c.env.DB.batch(statements); return c.json({ data: await drizzle(c.env.DB).select().from(customerAddresses).where(eq(customerAddresses.id, id)).get() });
});
api.delete("/customers/:customerId/addresses/:id", zValidator("param", customerAddressParam), async (c) => {
  const { customerId, id } = c.req.valid("param"), timestamp = now(), actor = c.get("actorEmail");
  const current = await drizzle(c.env.DB).select().from(customerAddresses).where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId))).get();
  if (!current) return apiError(c, 404, "NOT_FOUND", "Customer address not found.");
  const replacement = current.isDefault ? await c.env.DB.prepare("SELECT id, address FROM customer_addresses WHERE customer_id = ? AND id <> ? ORDER BY created_at LIMIT 1").bind(customerId, id).first<{ id: string; address: string }>() : null;
  const statements = [c.env.DB.prepare("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?").bind(id, customerId)];
  if (replacement) statements.push(c.env.DB.prepare("UPDATE customer_addresses SET is_default = 1, updated_at = ? WHERE id = ?").bind(timestamp, replacement.id));
  if (current.isDefault) statements.push(c.env.DB.prepare("UPDATE customers SET address = ?, updated_at = ? WHERE id = ?").bind(replacement?.address ?? null, timestamp, customerId));
  statements.push(auditStatement(c.env.DB, actor, "delete", "customer_address", id, { customerId }));
  await c.env.DB.batch(statements); return c.body(null, 204);
});
api.delete("/customers/:id", zValidator("param", idParam), async (c) => {
  const id = c.req.valid("param").id, actor = c.get("actorEmail");
  const customer = await c.env.DB.prepare("SELECT id, display_id AS displayId FROM customers WHERE id = ?").bind(id).first<{ id: string; displayId: string }>();
  if (!customer) return apiError(c, 404, "NOT_FOUND", "Customer not found.");
  const artifactRows = await c.env.DB.prepare("SELECT a.object_key AS objectKey FROM artifacts a JOIN estimates e ON e.id = a.estimate_id JOIN jobs j ON j.id = e.job_id WHERE j.customer_id = ?").bind(id).all<{ objectKey: string }>();
  if (!await removeArtifactKeys(c.env.ARTIFACTS, artifactRows.results.map((row) => row.objectKey), "customer", id)) return apiError(c, 502, "ARTIFACT_DELETE_FAILED", "Generated files could not be deleted. No records were changed; retry deletion.");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM estimate_adjustments WHERE estimate_id IN (SELECT e.id FROM estimates e JOIN jobs j ON j.id = e.job_id WHERE j.customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT e.id FROM estimates e JOIN jobs j ON j.id = e.job_id WHERE j.customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM artifacts WHERE estimate_id IN (SELECT e.id FROM estimates e JOIN jobs j ON j.id = e.job_id WHERE j.customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_draft_adjustments WHERE draft_id IN (SELECT d.id FROM estimate_drafts d JOIN jobs j ON j.id = d.job_id WHERE j.customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_draft_charges WHERE draft_id IN (SELECT d.id FROM estimate_drafts d JOIN jobs j ON j.id = d.job_id WHERE j.customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_drafts WHERE job_id IN (SELECT id FROM jobs WHERE customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimates WHERE job_id IN (SELECT id FROM jobs WHERE customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM job_materials WHERE job_id IN (SELECT id FROM jobs WHERE customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM job_line_items WHERE job_id IN (SELECT id FROM jobs WHERE customer_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM jobs WHERE customer_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM customer_addresses WHERE customer_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(id),
    auditStatement(c.env.DB, actor, "delete", "customer", id, { displayId: customer.displayId, cascade: true })
  ]);
  return c.body(null, 204);
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
api.patch("/jobs/:id", zValidator("param", idParam), zValidator("json", jobInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), timestamp = now(), actor = c.get("actorEmail");
  const existing = await drizzle(c.env.DB).select().from(jobs).where(eq(jobs.id, id)).get();
  if (!existing) return apiError(c, 404, "NOT_FOUND", "Job not found.");
  if (existing.customerId !== input.customerId) return apiError(c, 422, "CUSTOMER_MISMATCH", "A job cannot be moved to another customer.");
  const updated = await drizzle(c.env.DB).update(jobs).set({ name: input.name, address: input.address || null, scope: input.scope || null, notes: input.notes || null, updatedAt: timestamp }).where(eq(jobs.id, id)).returning().get();
  await auditStatement(c.env.DB, actor, "update", "job", id).run();
  return c.json({ data: updated });
});
api.delete("/jobs/:id", zValidator("param", idParam), async (c) => {
  const id = c.req.valid("param").id, actor = c.get("actorEmail");
  const job = await c.env.DB.prepare("SELECT id, display_id AS displayId FROM jobs WHERE id = ?").bind(id).first<{ id: string; displayId: string }>();
  if (!job) return apiError(c, 404, "NOT_FOUND", "Job not found.");
  const artifactRows = await c.env.DB.prepare("SELECT a.object_key AS objectKey FROM artifacts a JOIN estimates e ON e.id = a.estimate_id WHERE e.job_id = ?").bind(id).all<{ objectKey: string }>();
  if (!await removeArtifactKeys(c.env.ARTIFACTS, artifactRows.results.map((row) => row.objectKey), "job", id)) return apiError(c, 502, "ARTIFACT_DELETE_FAILED", "Generated files could not be deleted. No records were changed; retry deletion.");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM estimate_adjustments WHERE estimate_id IN (SELECT id FROM estimates WHERE job_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE job_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM artifacts WHERE estimate_id IN (SELECT id FROM estimates WHERE job_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_draft_adjustments WHERE draft_id IN (SELECT id FROM estimate_drafts WHERE job_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_draft_charges WHERE draft_id IN (SELECT id FROM estimate_drafts WHERE job_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_drafts WHERE job_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM estimates WHERE job_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM job_materials WHERE job_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM job_line_items WHERE job_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(id),
    auditStatement(c.env.DB, actor, "delete", "job", id, { displayId: job.displayId, cascade: true })
  ]);
  return c.body(null, 204);
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

api.get("/jobs/:id/materials", zValidator("param", idParam), async (c) => c.json({ data: await drizzle(c.env.DB).select().from(jobMaterials).where(eq(jobMaterials.jobId, c.req.valid("param").id)).orderBy(jobMaterials.position).all() }));
api.post("/jobs/:id/materials", zValidator("param", idParam), zValidator("json", materialInput), async (c) => {
  const jobId = c.req.valid("param").id, input = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  try { await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO job_materials(id, job_id, catalog_item_id, position, description, quantity, unit, unit_cost_cents, retailer, sku_or_model, product_url, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, jobId, input.catalogItemId ?? null, input.position, input.description, input.quantity, input.unit, input.unitCostCents ?? null, input.retailer ?? null, input.skuOrModel ?? null, input.productUrl || null, input.notes ?? null, timestamp, timestamp),
    auditStatement(c.env.DB, actor, "create", "job_material", id, { jobId })
  ]); } catch { return apiError(c, 409, "MATERIAL_CONFLICT", "The job, material library item, or row position is invalid."); }
  return c.json({ data: await drizzle(c.env.DB).select().from(jobMaterials).where(eq(jobMaterials.id, id)).get() }, 201);
});
api.patch("/jobs/:jobId/materials/:id", zValidator("param", jobLineParam), zValidator("json", materialInput), async (c) => {
  const { id, jobId } = c.req.valid("param"), input = c.req.valid("json"), timestamp = now(), actor = c.get("actorEmail");
  let updated;
  try { updated = await drizzle(c.env.DB).update(jobMaterials).set({ catalogItemId: input.catalogItemId ?? null, position: input.position, description: input.description, quantity: input.quantity, unit: input.unit, unitCostCents: input.unitCostCents ?? null, retailer: input.retailer || null, skuOrModel: input.skuOrModel || null, productUrl: input.productUrl || null, notes: input.notes || null, updatedAt: timestamp }).where(and(eq(jobMaterials.id, id), eq(jobMaterials.jobId, jobId))).returning().get(); }
  catch { return apiError(c, 409, "MATERIAL_CONFLICT", "The material row position or library reference is invalid."); }
  if (!updated) return apiError(c, 404, "NOT_FOUND", "Material not found.");
  await auditStatement(c.env.DB, actor, "update", "job_material", id, { jobId }).run(); return c.json({ data: updated });
});
api.delete("/jobs/:jobId/materials/:id", zValidator("param", jobLineParam), async (c) => {
  const { id, jobId } = c.req.valid("param"), actor = c.get("actorEmail");
  const deleted = await drizzle(c.env.DB).delete(jobMaterials).where(and(eq(jobMaterials.id, id), eq(jobMaterials.jobId, jobId))).returning().get();
  if (!deleted) return apiError(c, 404, "NOT_FOUND", "Material not found.");
  await auditStatement(c.env.DB, actor, "delete", "job_material", id, { jobId }).run(); return c.body(null, 204);
});
api.get("/jobs/:id/materials.:format", async (c) => {
  const parsed = z.object({ id: z.uuid(), format: z.enum(["csv", "xlsx"]) }).safeParse(c.req.param());
  if (!parsed.success) return apiError(c, 400, "INVALID_REQUEST", "Use csv or xlsx with a valid job ID.");
  const job = await c.env.DB.prepare("SELECT display_id AS displayId, name FROM jobs WHERE id = ?").bind(parsed.data.id).first<{ displayId: string; name: string }>();
  if (!job) return apiError(c, 404, "NOT_FOUND", "Job not found.");
  const rows = await drizzle(c.env.DB).select().from(jobMaterials).where(eq(jobMaterials.jobId, parsed.data.id)).orderBy(jobMaterials.position).all() as MaterialExportRow[];
  const isCsv = parsed.data.format === "csv", data = isCsv ? new TextEncoder().encode(materialsCsv(job, rows)) : materialsXlsx(job, rows);
  return new Response(data as BodyInit, { headers: { "Content-Type": isCsv ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="materials-${job.displayId}.${parsed.data.format}"`, "Cache-Control": "private, no-store" } });
});

api.get("/catalog", async (c) => c.json({ data: await drizzle(c.env.DB).select().from(catalogItems).orderBy(desc(catalogItems.createdAt)).all() }));
api.get("/materials", async (c) => c.json({ data: await drizzle(c.env.DB).select().from(catalogItems).orderBy(desc(catalogItems.createdAt)).all() }));
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
api.post("/materials", zValidator("json", catalogWithOfferInput), async (c) => {
  const { retailerOffer, ...input } = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  const statements: D1PreparedStatement[] = [c.env.DB.prepare("INSERT INTO catalog_items(id, description, unit, default_price_cents, active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, input.description, input.unit, input.defaultPriceCents, input.active ? 1 : 0, input.notes ?? null, timestamp, timestamp), auditStatement(c.env.DB, actor, "create", "material_library_item", id)];
  if (retailerOffer) { const offerId = crypto.randomUUID(); statements.push(c.env.DB.prepare("INSERT INTO retailer_offers(id, catalog_item_id, retailer, sku, model_or_upc, product_url, store_context, observed_price_cents, observed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(offerId, id, retailerOffer.retailer, retailerOffer.sku ?? null, retailerOffer.modelOrUpc ?? null, retailerOffer.productUrl || null, retailerOffer.storeContext ?? null, retailerOffer.observedPriceCents, retailerOffer.observedAt, timestamp, timestamp), c.env.DB.prepare("INSERT INTO price_history(id, retailer_offer_id, price_cents, observed_at, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)").bind(crypto.randomUUID(), offerId, retailerOffer.observedPriceCents, retailerOffer.observedAt, timestamp)); }
  await c.env.DB.batch(statements); return c.json({ data: await drizzle(c.env.DB).select().from(catalogItems).where(eq(catalogItems.id, id)).get() }, 201);
});
api.patch("/catalog/:id", zValidator("param", idParam), zValidator("json", catalogInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), actor = c.get("actorEmail"), timestamp = now();
  const updated = await drizzle(c.env.DB).update(catalogItems).set({ ...input, notes: input.notes || null, updatedAt: timestamp }).where(eq(catalogItems.id, id)).returning().get();
  if (!updated) return apiError(c, 404, "NOT_FOUND", "Catalog item not found.");
  await auditStatement(c.env.DB, actor, "update", "catalog_item", id).run();
  return c.json({ data: updated });
});
api.patch("/materials/:id", zValidator("param", idParam), zValidator("json", catalogInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), actor = c.get("actorEmail");
  const updated = await drizzle(c.env.DB).update(catalogItems).set({ ...input, notes: input.notes || null, updatedAt: now() }).where(eq(catalogItems.id, id)).returning().get();
  if (!updated) return apiError(c, 404, "NOT_FOUND", "Material library item not found."); await auditStatement(c.env.DB, actor, "update", "material_library_item", id).run(); return c.json({ data: updated });
});
api.delete("/catalog/:id", zValidator("param", idParam), async (c) => {
  const id = c.req.valid("param").id, actor = c.get("actorEmail");
  const item = await drizzle(c.env.DB).select().from(catalogItems).where(eq(catalogItems.id, id)).get();
  if (!item) return apiError(c, 404, "NOT_FOUND", "Catalog item not found.");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM price_history WHERE retailer_offer_id IN (SELECT id FROM retailer_offers WHERE catalog_item_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM retailer_offers WHERE catalog_item_id = ?").bind(id),
    c.env.DB.prepare("UPDATE job_line_items SET catalog_item_id = NULL, updated_at = ? WHERE catalog_item_id = ?").bind(now(), id),
    c.env.DB.prepare("UPDATE job_materials SET catalog_item_id = NULL, updated_at = ? WHERE catalog_item_id = ?").bind(now(), id),
    c.env.DB.prepare("DELETE FROM catalog_items WHERE id = ?").bind(id),
    auditStatement(c.env.DB, actor, "delete", "catalog_item", id, { description: item.description })
  ]);
  return c.body(null, 204);
});
api.delete("/materials/:id", zValidator("param", idParam), async (c) => {
  const id = c.req.valid("param").id, actor = c.get("actorEmail"), item = await drizzle(c.env.DB).select().from(catalogItems).where(eq(catalogItems.id, id)).get();
  if (!item) return apiError(c, 404, "NOT_FOUND", "Material library item not found.");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM price_history WHERE retailer_offer_id IN (SELECT id FROM retailer_offers WHERE catalog_item_id = ?)").bind(id), c.env.DB.prepare("DELETE FROM retailer_offers WHERE catalog_item_id = ?").bind(id), c.env.DB.prepare("UPDATE job_line_items SET catalog_item_id = NULL, updated_at = ? WHERE catalog_item_id = ?").bind(now(), id), c.env.DB.prepare("UPDATE job_materials SET catalog_item_id = NULL, updated_at = ? WHERE catalog_item_id = ?").bind(now(), id), c.env.DB.prepare("DELETE FROM catalog_items WHERE id = ?").bind(id), auditStatement(c.env.DB, actor, "delete", "material_library_item", id)]);
  return c.body(null, 204);
});
api.get("/catalog/:id/retailer-offers", zValidator("param", idParam), async (c) => c.json({ data: await drizzle(c.env.DB).select().from(retailerOffers).where(eq(retailerOffers.catalogItemId, c.req.valid("param").id)).orderBy(desc(retailerOffers.observedAt)).all() }));
api.get("/materials/:id/retailer-offers", zValidator("param", idParam), async (c) => c.json({ data: await drizzle(c.env.DB).select().from(retailerOffers).where(eq(retailerOffers.catalogItemId, c.req.valid("param").id)).orderBy(desc(retailerOffers.observedAt)).all() }));
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
api.delete("/retailer-offers/:id", zValidator("param", idParam), async (c) => {
  const id = c.req.valid("param").id, actor = c.get("actorEmail");
  const offer = await drizzle(c.env.DB).select().from(retailerOffers).where(eq(retailerOffers.id, id)).get();
  if (!offer) return apiError(c, 404, "NOT_FOUND", "Retailer offer not found.");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM price_history WHERE retailer_offer_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM retailer_offers WHERE id = ?").bind(id),
    auditStatement(c.env.DB, actor, "delete", "retailer_offer", id, { catalogItemId: offer.catalogItemId })
  ]);
  return c.body(null, 204);
});

api.get("/jobs/:id/estimate-draft", zValidator("param", idParam), async (c) => {
  const jobId = c.req.valid("param").id, timestamp = now(), draftId = crypto.randomUUID();
  const job = await c.env.DB.prepare("SELECT j.id, j.display_id AS displayId, j.name, j.address, j.scope, j.notes AS jobNotes, j.customer_id AS customerId, c.display_id AS customerDisplayId, c.name AS customerName, c.email AS customerEmail, c.phone AS customerPhone, c.address AS customerAddress FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?").bind(jobId).first<Record<string, string | null>>();
  if (!job) return apiError(c, 404, "NOT_FOUND", "Job not found.");
  const latest = await c.env.DB.prepare("SELECT id, notes FROM estimates WHERE job_id = ? ORDER BY version DESC LIMIT 1").bind(jobId).first<{ id: string; notes: string | null }>();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO estimate_drafts(id, job_id, notes, source_estimate_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO NOTHING").bind(draftId, jobId, latest?.notes ?? null, latest?.id ?? null, timestamp, timestamp),
    c.env.DB.prepare("INSERT INTO estimate_draft_charges(id, draft_id, position, description, details, amount_cents, created_at, updated_at) SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, position, description, details, amount_cents, ?, ? FROM estimate_line_items WHERE estimate_id = ? AND EXISTS (SELECT 1 FROM estimate_drafts WHERE id = ?)").bind(draftId, timestamp, timestamp, latest?.id ?? "", draftId),
    c.env.DB.prepare("INSERT INTO estimate_draft_adjustments(draft_id, kind, mode, value) SELECT ?, kind, mode, value FROM estimate_adjustments WHERE estimate_id = ? AND EXISTS (SELECT 1 FROM estimate_drafts WHERE id = ?)").bind(draftId, latest?.id ?? "", draftId)
  ]);
  return c.json({ data: await readDraft(c.env.DB, jobId, job) });
});
api.patch("/estimate-drafts/:id", zValidator("param", idParam), zValidator("json", draftMetadataInput), async (c) => {
  const id = c.req.valid("param").id, input = c.req.valid("json"), timestamp = now(), actor = c.get("actorEmail");
  const draft = await c.env.DB.prepare("SELECT id, job_id AS jobId FROM estimate_drafts WHERE id = ?").bind(id).first<{ id: string; jobId: string }>();
  if (!draft) return apiError(c, 404, "NOT_FOUND", "Estimate draft not found.");
  await c.env.DB.batch([c.env.DB.prepare("UPDATE estimate_drafts SET notes = ?, updated_at = ? WHERE id = ?").bind(input.notes ?? null, timestamp, id), c.env.DB.prepare("DELETE FROM estimate_draft_adjustments WHERE draft_id = ?").bind(id), ...input.adjustments.map((item) => c.env.DB.prepare("INSERT INTO estimate_draft_adjustments(draft_id, kind, mode, value) VALUES (?, ?, ?, ?)").bind(id, item.kind, item.mode, item.value)), auditStatement(c.env.DB, actor, "autosave", "estimate_draft", id)]);
  return c.json({ data: await readDraft(c.env.DB, draft.jobId) });
});
api.post("/estimate-drafts/:id/charges", zValidator("param", idParam), zValidator("json", draftChargeInput), async (c) => {
  const draftId = c.req.valid("param").id, input = c.req.valid("json"), id = crypto.randomUUID(), timestamp = now(), actor = c.get("actorEmail");
  try { await c.env.DB.batch([c.env.DB.prepare("INSERT INTO estimate_draft_charges(id, draft_id, position, description, details, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, draftId, input.position, input.description, input.details ?? null, input.amountCents, timestamp, timestamp), c.env.DB.prepare("UPDATE estimate_drafts SET updated_at = ? WHERE id = ?").bind(timestamp, draftId), auditStatement(c.env.DB, actor, "create", "draft_charge", id, { draftId })]); }
  catch { return apiError(c, 409, "CHARGE_CONFLICT", "The draft or charge position is invalid."); }
  return c.json({ data: await c.env.DB.prepare("SELECT id, position, description, details, amount_cents AS amountCents FROM estimate_draft_charges WHERE id = ?").bind(id).first() }, 201);
});
api.patch("/estimate-drafts/:id/charges/:chargeId", zValidator("param", draftChargeParam), zValidator("json", draftChargeInput), async (c) => {
  const { id, chargeId } = c.req.valid("param"), input = c.req.valid("json"), timestamp = now(), actor = c.get("actorEmail");
  let result: D1Result;
  try { [result] = await c.env.DB.batch([c.env.DB.prepare("UPDATE estimate_draft_charges SET position = ?, description = ?, details = ?, amount_cents = ?, updated_at = ? WHERE id = ? AND draft_id = ?").bind(input.position, input.description, input.details ?? null, input.amountCents, timestamp, chargeId, id), c.env.DB.prepare("UPDATE estimate_drafts SET updated_at = ? WHERE id = ?").bind(timestamp, id), auditStatement(c.env.DB, actor, "update", "draft_charge", chargeId, { draftId: id })]); }
  catch { return apiError(c, 409, "CHARGE_CONFLICT", "The charge position is already in use."); }
  if (!result.meta.changes) return apiError(c, 404, "NOT_FOUND", "Charge not found."); return c.json({ data: { id: chargeId, ...input } });
});
api.put("/estimate-drafts/:id/charges/order", zValidator("param", idParam), zValidator("json", draftOrderInput), async (c) => {
  const id = c.req.valid("param").id, { chargeIds } = c.req.valid("json"), timestamp = now(), actor = c.get("actorEmail");
  const current = await c.env.DB.prepare("SELECT id FROM estimate_draft_charges WHERE draft_id = ? ORDER BY position").bind(id).all<{ id: string }>();
  if (current.results.length !== chargeIds.length || new Set(current.results.map((row) => row.id)).size !== new Set(chargeIds).size || chargeIds.some((chargeId) => !current.results.some((row) => row.id === chargeId))) return apiError(c, 422, "INVALID_ORDER", "Order must contain every draft charge exactly once.");
  await c.env.DB.batch([c.env.DB.prepare("UPDATE estimate_draft_charges SET position = position + 10000 WHERE draft_id = ?").bind(id), ...chargeIds.map((chargeId, position) => c.env.DB.prepare("UPDATE estimate_draft_charges SET position = ?, updated_at = ? WHERE id = ? AND draft_id = ?").bind(position, timestamp, chargeId, id)), c.env.DB.prepare("UPDATE estimate_drafts SET updated_at = ? WHERE id = ?").bind(timestamp, id), auditStatement(c.env.DB, actor, "reorder", "estimate_draft", id)]);
  return c.json({ data: { chargeIds } });
});
api.delete("/estimate-drafts/:id/charges/:chargeId", zValidator("param", draftChargeParam), async (c) => {
  const { id, chargeId } = c.req.valid("param"), actor = c.get("actorEmail"), timestamp = now();
  const [result] = await c.env.DB.batch([c.env.DB.prepare("DELETE FROM estimate_draft_charges WHERE id = ? AND draft_id = ?").bind(chargeId, id), c.env.DB.prepare("UPDATE estimate_drafts SET updated_at = ? WHERE id = ?").bind(timestamp, id), auditStatement(c.env.DB, actor, "delete", "draft_charge", chargeId, { draftId: id })]);
  if (!result.meta.changes) return apiError(c, 404, "NOT_FOUND", "Charge not found."); return c.body(null, 204);
});
api.post("/estimate-drafts/:id/finalize", zValidator("param", idParam), async (c) => {
  const draftId = c.req.valid("param").id, actor = c.get("actorEmail"), timestamp = now(), estimateId = crypto.randomUUID();
  const base = await c.env.DB.prepare("SELECT d.job_id AS jobId, d.notes, j.display_id AS jobDisplayId, j.name AS jobName, j.address AS jobAddress, j.scope AS jobScope, c.display_id AS customerDisplayId, c.name AS customerName, c.email AS customerEmail, c.phone AS customerPhone, c.address AS customerAddress FROM estimate_drafts d JOIN jobs j ON j.id = d.job_id JOIN customers c ON c.id = j.customer_id WHERE d.id = ?").bind(draftId).first<Record<string, string | null>>();
  if (!base) return apiError(c, 404, "NOT_FOUND", "Estimate draft not found.");
  const charges = (await c.env.DB.prepare("SELECT id, position, description, details, amount_cents AS amountCents FROM estimate_draft_charges WHERE draft_id = ? ORDER BY position").bind(draftId).all<{ id: string; position: number; description: string; details: string | null; amountCents: number }>()).results;
  if (!charges.length) return apiError(c, 422, "NO_CHARGES", "Add at least one charge before finalizing.");
  const adjustments = (await c.env.DB.prepare("SELECT kind, mode, value FROM estimate_draft_adjustments WHERE draft_id = ?").bind(draftId).all<AdjustmentInput>()).results, totals = calculateEstimateCharges(charges, adjustments);
  const customer = { displayId: base.customerDisplayId!, name: base.customerName!, email: base.customerEmail, phone: base.customerPhone, address: base.customerAddress }, job = { displayId: base.jobDisplayId!, name: base.jobName!, address: base.jobAddress, scope: base.jobScope };
  const amountByKind: Record<AdjustmentInput["kind"], number> = { markup: totals.markupCents, discount: totals.discountCents, tax: totals.taxCents, deposit: totals.depositCents };
  const statements: D1PreparedStatement[] = [c.env.DB.prepare("INSERT INTO estimates(id, job_id, display_id, version, customer_snapshot_json, job_snapshot_json, notes, subtotal_cents, total_cents, deposit_cents, balance_due_cents, generated_at, generated_by) SELECT ?, d.job_id, 'EST-' || j.display_id || '-v' || printf('%02d', COALESCE(MAX(e.version), 0) + 1), COALESCE(MAX(e.version), 0) + 1, ?, ?, d.notes, ?, ?, ?, ?, ?, ? FROM estimate_drafts d JOIN jobs j ON j.id = d.job_id LEFT JOIN estimates e ON e.job_id = d.job_id WHERE d.id = ? GROUP BY d.id").bind(estimateId, JSON.stringify(customer), JSON.stringify(job), totals.subtotalCents, totals.totalCents, totals.depositCents, totals.balanceDueCents, timestamp, actor, draftId), ...charges.map((line) => c.env.DB.prepare("INSERT INTO estimate_line_items(id, estimate_id, source_line_item_id, position, description, details, sku_or_model, unit, quantity, unit_price_cents, amount_cents) VALUES (?, ?, ?, ?, ?, ?, NULL, 'flat', 1, ?, ?)").bind(crypto.randomUUID(), estimateId, line.id, line.position, line.description, line.details, line.amountCents, line.amountCents)), ...adjustments.map((item) => c.env.DB.prepare("INSERT INTO estimate_adjustments(estimate_id, kind, mode, value, amount_cents) VALUES (?, ?, ?, ?, ?)").bind(estimateId, item.kind, item.mode, item.value, amountByKind[item.kind])), c.env.DB.prepare("DELETE FROM estimate_draft_adjustments WHERE draft_id = ?").bind(draftId), c.env.DB.prepare("DELETE FROM estimate_draft_charges WHERE draft_id = ?").bind(draftId), c.env.DB.prepare("DELETE FROM estimate_drafts WHERE id = ?").bind(draftId), auditStatement(c.env.DB, actor, "finalize", "estimate", estimateId, { draftId, jobId: base.jobId })];
  try { await c.env.DB.batch(statements); } catch (error) { console.error(JSON.stringify({ message: "draft finalization conflict", draftId, error: error instanceof Error ? error.message : "unknown" })); return apiError(c, 409, "FINALIZE_CONFLICT", "This draft was already finalized or changed. Reload and retry."); }
  const created = await drizzle(c.env.DB).select().from(estimates).where(eq(estimates.id, estimateId)).get(); if (!created) return apiError(c, 409, "FINALIZE_CONFLICT", "This draft was already finalized.");
  const snapshot: EstimateSnapshot = { estimateId, displayId: created.displayId, version: created.version, generatedAt: timestamp, customer, job, lines: charges, adjustments, totals, notes: base.notes };
  const generated = await generateArtifacts(c.env, snapshot); return c.json({ data: { ...created, artifacts: generated } }, 201);
});

api.get("/estimates", async (c) => {
  const [estimateRows, artifactRows] = await Promise.all([
    drizzle(c.env.DB).select().from(estimates).orderBy(desc(estimates.generatedAt)).all(),
    drizzle(c.env.DB).select({ id: artifacts.id, estimateId: artifacts.estimateId, format: artifacts.format, filename: artifacts.filename, status: artifacts.status }).from(artifacts).all()
  ]);
  const artifactsByEstimate = new Map<string, typeof artifactRows>();
  for (const artifact of artifactRows) artifactsByEstimate.set(artifact.estimateId, [...(artifactsByEstimate.get(artifact.estimateId) ?? []), artifact]);
  return c.json({ data: estimateRows.map((estimate) => ({ ...estimate, customer: JSON.parse(estimate.customerSnapshotJson) as EstimateSnapshot["customer"], job: JSON.parse(estimate.jobSnapshotJson) as EstimateSnapshot["job"], artifacts: artifactsByEstimate.get(estimate.id) ?? [] })) });
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
api.delete("/estimates/:id", zValidator("param", idParam), async (c) => {
  const id = c.req.valid("param").id, actor = c.get("actorEmail");
  const estimate = await drizzle(c.env.DB).select().from(estimates).where(eq(estimates.id, id)).get();
  if (!estimate) return apiError(c, 404, "NOT_FOUND", "Estimate not found.");
  const artifactRows = await c.env.DB.prepare("SELECT object_key AS objectKey FROM artifacts WHERE estimate_id = ?").bind(id).all<{ objectKey: string }>();
  if (!await removeArtifactKeys(c.env.ARTIFACTS, artifactRows.results.map((row) => row.objectKey), "estimate", id)) return apiError(c, 502, "ARTIFACT_DELETE_FAILED", "Generated files could not be deleted. No records were changed; retry deletion.");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE estimate_drafts SET source_estimate_id = NULL WHERE source_estimate_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_adjustments WHERE estimate_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM estimate_line_items WHERE estimate_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM artifacts WHERE estimate_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM estimates WHERE id = ?").bind(id),
    auditStatement(c.env.DB, actor, "delete", "estimate", id, { displayId: estimate.displayId })
  ]);
  return c.body(null, 204);
});
api.post("/estimates/:id/artifacts/retry", zValidator("param", idParam), zValidator("json", artifactRetryInput), async (c) => {
  const id = c.req.valid("param").id, requested = c.req.valid("json").formats, actor = c.get("actorEmail"), snapshot = await readEstimateSnapshot(c.env.DB, id);
  if (!snapshot) return apiError(c, 404, "NOT_FOUND", "Estimate not found.");
  const existing = await drizzle(c.env.DB).select().from(artifacts).where(eq(artifacts.estimateId, id)).all();
  const formats = requested ?? existing.filter((item) => item.status === "failed").map((item) => item.format as "pdf" | "xlsx" | "csv");
  if (!formats.length) return apiError(c, 422, "NOTHING_TO_RETRY", "This estimate has no failed artifacts.");
  const generated = await generateArtifacts(c.env, snapshot, formats); await auditStatement(c.env.DB, actor, "retry_artifacts", "estimate", id, { formats }).run(); return c.json({ data: generated });
});

api.get("/artifacts/:id/download", zValidator("param", idParam), async (c) => {
  const artifact = await drizzle(c.env.DB).select().from(artifacts).where(eq(artifacts.id, c.req.valid("param").id)).get();
  if (!artifact || artifact.status !== "ready") return apiError(c, 404, "NOT_FOUND", "Artifact is not available.");
  const object = await c.env.ARTIFACTS.get(artifact.objectKey); if (!object) return apiError(c, 404, "OBJECT_MISSING", "Stored artifact is missing.");
  const headers = new Headers({ "Content-Type": artifact.contentType, "Content-Disposition": `attachment; filename="${artifact.filename.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  return new Response(object.body, { headers });
});

api.get("/export", async (c) => {
  const tableNames = ["customers", "customer_addresses", "jobs", "job_line_items", "job_materials", "catalog_items", "retailer_offers", "price_history", "estimate_drafts", "estimate_draft_charges", "estimate_draft_adjustments", "estimates", "estimate_line_items", "estimate_adjustments"];
  const tables = await Promise.all(tableNames.map(async (name) => ({ name: name === "job_line_items" ? "line_items" : name === "catalog_items" ? "catalog" : name, rows: (await c.env.DB.prepare(`SELECT * FROM ${name}`).all()).results as Record<string, unknown>[] })));
  const data = fullExportZip(tables); return new Response(data as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="pro-angle-full-export-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "private, no-store" } });
});
api.get("/export/customers", async (c) => {
  const customerRows = await drizzle(c.env.DB).select().from(customers).orderBy(customers.displayId).all(), jobRows = await drizzle(c.env.DB).select().from(jobs).orderBy(jobs.displayId).all(), materialRows = await drizzle(c.env.DB).select().from(jobMaterials).orderBy(jobMaterials.jobId, jobMaterials.position).all(), estimateRows = await drizzle(c.env.DB).select().from(estimates).orderBy(estimates.jobId, estimates.version).all(), artifactRows = await drizzle(c.env.DB).select().from(artifacts).where(eq(artifacts.status, "ready")).all();
  const tree: FriendlyCustomer[] = [];
  for (const customer of customerRows) {
    const customerEntry: FriendlyCustomer = { id: customer.id, displayId: customer.displayId, name: customer.name, jobs: [] };
    for (const job of jobRows.filter((item) => item.customerId === customer.id)) {
      const rows = materialRows.filter((item) => item.jobId === job.id), files: FriendlyCustomer["jobs"][number]["files"] = [];
      files.push({ name: "materials.csv", data: new TextEncoder().encode(materialsCsv({ displayId: job.displayId, name: job.name }, rows)), entityId: job.id, displayId: job.displayId }, { name: "materials.xlsx", data: materialsXlsx({ displayId: job.displayId, name: job.name }, rows), entityId: job.id, displayId: job.displayId });
      for (const estimate of estimateRows.filter((item) => item.jobId === job.id)) for (const artifact of artifactRows.filter((item) => item.estimateId === estimate.id)) { const object = await c.env.ARTIFACTS.get(artifact.objectKey); if (object) files.push({ name: `estimate_${String(estimate.version).padStart(4, "0")}.${artifact.format}`, data: new Uint8Array(await object.arrayBuffer()), entityId: estimate.id, displayId: estimate.displayId }); }
      customerEntry.jobs.push({ id: job.id, displayId: job.displayId, name: job.name, files });
    }
    tree.push(customerEntry);
  }
  const data = await customerExportZip(tree); return new Response(data as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="pro-angle-customer-export-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "private, no-store" } });
});

api.delete("/workspace-data", zValidator("json", clearWorkspaceInput), async (c) => {
  const actor = c.get("actorEmail"), timestamp = now();
  if (!await removeAllArtifactObjects(c.env.ARTIFACTS)) return apiError(c, 502, "ARTIFACT_DELETE_FAILED", "Generated files could not be cleared. No database records were changed; retry the operation.");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM price_history"),
    c.env.DB.prepare("DELETE FROM retailer_offers"),
    c.env.DB.prepare("DELETE FROM estimate_adjustments"),
    c.env.DB.prepare("DELETE FROM estimate_draft_adjustments"),
    c.env.DB.prepare("DELETE FROM estimate_draft_charges"),
    c.env.DB.prepare("DELETE FROM estimate_drafts"),
    c.env.DB.prepare("DELETE FROM estimate_line_items"),
    c.env.DB.prepare("DELETE FROM artifacts"),
    c.env.DB.prepare("DELETE FROM estimates"),
    c.env.DB.prepare("DELETE FROM job_line_items"),
    c.env.DB.prepare("DELETE FROM job_materials"),
    c.env.DB.prepare("DELETE FROM jobs"),
    c.env.DB.prepare("DELETE FROM catalog_items"),
    c.env.DB.prepare("DELETE FROM customer_addresses"),
    c.env.DB.prepare("DELETE FROM customers"),
    c.env.DB.prepare("DELETE FROM settings"),
    c.env.DB.prepare("DELETE FROM counters"),
    c.env.DB.prepare("DELETE FROM audit_events"),
    c.env.DB.prepare("INSERT INTO counters(scope, next_value, updated_at) VALUES ('customer', 1, ?)").bind(timestamp),
    auditStatement(c.env.DB, actor, "clear", "workspace", "all", { generatedArtifactsDeleted: true, backupsPreserved: true })
  ]);
  return c.body(null, 204);
});

async function deleteArtifactKeys(bucket: R2Bucket, keys: string[]) {
  for (let offset = 0; offset < keys.length; offset += 1_000) await bucket.delete(keys.slice(offset, offset + 1_000));
}

async function removeArtifactKeys(bucket: R2Bucket, keys: string[], entityType: string, entityId: string) {
  try { await deleteArtifactKeys(bucket, keys); return true; }
  catch (error) { console.error(JSON.stringify({ message: "artifact deletion failed", entityType, entityId, error: error instanceof Error ? error.message : "unknown" })); return false; }
}

async function removeAllArtifactObjects(bucket: R2Bucket) {
  try {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ cursor });
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    await deleteArtifactKeys(bucket, keys);
    return true;
  } catch (error) { console.error(JSON.stringify({ message: "workspace artifact clear failed", error: error instanceof Error ? error.message : "unknown" })); return false; }
}

async function readDraft(db: D1Database, jobId: string, suppliedJob?: Record<string, string | null>) {
  const job = suppliedJob ?? await db.prepare("SELECT j.id, j.display_id AS displayId, j.name, j.address, j.scope, j.notes AS jobNotes, j.customer_id AS customerId, c.display_id AS customerDisplayId, c.name AS customerName, c.email AS customerEmail, c.phone AS customerPhone, c.address AS customerAddress FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?").bind(jobId).first<Record<string, string | null>>();
  if (!job) return null;
  const draft = await db.prepare("SELECT id, job_id AS jobId, notes, source_estimate_id AS sourceEstimateId, created_at AS createdAt, updated_at AS updatedAt FROM estimate_drafts WHERE job_id = ?").bind(jobId).first<{ id: string; jobId: string; notes: string | null; sourceEstimateId: string | null; createdAt: string; updatedAt: string }>();
  if (!draft) return null;
  const charges = (await db.prepare("SELECT id, position, description, details, amount_cents AS amountCents FROM estimate_draft_charges WHERE draft_id = ? ORDER BY position").bind(draft.id).all<{ id: string; position: number; description: string; details: string | null; amountCents: number }>()).results;
  const adjustments = (await db.prepare("SELECT kind, mode, value FROM estimate_draft_adjustments WHERE draft_id = ?").bind(draft.id).all<AdjustmentInput>()).results;
  return { ...draft, job: { id: job.id, displayId: job.displayId, name: job.name, address: job.address, scope: job.scope, notes: job.jobNotes }, customer: { id: job.customerId, displayId: job.customerDisplayId, name: job.customerName, email: job.customerEmail, phone: job.customerPhone, address: job.customerAddress }, charges, adjustments, totals: calculateEstimateCharges(charges, adjustments) };
}

async function readEstimateSnapshot(db: D1Database, estimateId: string): Promise<EstimateSnapshot | null> {
  const estimate = await drizzle(db).select().from(estimates).where(eq(estimates.id, estimateId)).get(); if (!estimate) return null;
  const lines = (await db.prepare("SELECT id, position, description, details, amount_cents AS amountCents FROM estimate_line_items WHERE estimate_id = ? ORDER BY position").bind(estimateId).all<{ id: string; position: number; description: string; details: string | null; amountCents: number }>()).results;
  const adjustmentRows = (await db.prepare("SELECT kind, mode, value FROM estimate_adjustments WHERE estimate_id = ?").bind(estimateId).all<AdjustmentInput>()).results;
  return { estimateId, displayId: estimate.displayId, version: estimate.version, generatedAt: estimate.generatedAt, customer: JSON.parse(estimate.customerSnapshotJson) as EstimateSnapshot["customer"], job: JSON.parse(estimate.jobSnapshotJson) as EstimateSnapshot["job"], lines, adjustments: adjustmentRows, totals: calculateEstimateCharges(lines, adjustmentRows), notes: estimate.notes };
}

async function generateArtifacts(env: Env, snapshot: EstimateSnapshot, formats: Array<"csv" | "xlsx" | "pdf"> = ["csv", "xlsx", "pdf"]) {
  const outputs: Array<{ format: "csv" | "xlsx" | "pdf"; data?: Uint8Array; contentType: string; error?: string }> = [];
  if (formats.includes("csv")) outputs.push({ format: "csv", data: new TextEncoder().encode(estimateCsv(snapshot)), contentType: "text/csv; charset=utf-8" });
  if (formats.includes("xlsx")) outputs.push({ format: "xlsx", data: estimateXlsx(snapshot), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (formats.includes("pdf")) try { const response = await env.BROWSER.quickAction("pdf", { html: estimateHtml(snapshot), pdfOptions: { format: "letter", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } } }); if (!response.ok) throw new Error(`Browser Run returned ${response.status}`); outputs.push({ format: "pdf", data: new Uint8Array(await response.arrayBuffer()), contentType: "application/pdf" }); }
  catch (error) { outputs.push({ format: "pdf", contentType: "application/pdf", error: error instanceof Error ? error.message : "PDF generation failed" }); }
  const result = [];
  for (const output of outputs) {
    const id = crypto.randomUUID(), filename = safeArtifactFilename(snapshot.displayId, snapshot.customer.name, output.format), key = `estimates/${snapshot.job.displayId}/${snapshot.displayId}/${filename}`, createdAt = now();
    if (output.data) { const checksum = await sha256Hex(output.data); await env.ARTIFACTS.put(key, output.data, { httpMetadata: { contentType: output.contentType }, customMetadata: { checksum, estimateId: snapshot.estimateId } }); await env.DB.prepare("INSERT INTO artifacts(id, estimate_id, format, object_key, filename, content_type, size_bytes, checksum_sha256, status, failure_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, ?) ON CONFLICT(estimate_id, format) DO UPDATE SET object_key=excluded.object_key, filename=excluded.filename, content_type=excluded.content_type, size_bytes=excluded.size_bytes, checksum_sha256=excluded.checksum_sha256, status='ready', failure_reason=NULL").bind(id, snapshot.estimateId, output.format, key, filename, output.contentType, output.data.byteLength, checksum, createdAt).run(); }
    else { await env.DB.prepare("INSERT INTO artifacts(id, estimate_id, format, object_key, filename, content_type, status, failure_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?) ON CONFLICT(estimate_id, format) DO UPDATE SET status='failed', failure_reason=excluded.failure_reason").bind(id, snapshot.estimateId, output.format, key, filename, output.contentType, output.error, createdAt).run(); }
    const stored = await env.DB.prepare("SELECT id, format, filename, status FROM artifacts WHERE estimate_id = ? AND format = ?").bind(snapshot.estimateId, output.format).first(); result.push(stored);
  }
  return result;
}
