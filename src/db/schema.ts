import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
};

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(), displayId: text("display_id").notNull().unique(), name: text("name").notNull(), email: text("email"), phone: text("phone"), address: text("address"), notes: text("notes"), ...timestamps
}, (table) => [index("customers_name_idx").on(table.name)]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), displayId: text("display_id").notNull().unique(), customerId: text("customer_id").notNull().references(() => customers.id), name: text("name").notNull(), address: text("address"), scope: text("scope"), notes: text("notes"), status: text("status").notNull().default("draft"), ...timestamps
}, (table) => [index("jobs_customer_idx").on(table.customerId), index("jobs_status_idx").on(table.status)]);

export const catalogItems = sqliteTable("catalog_items", {
  id: text("id").primaryKey(), description: text("description").notNull(), unit: text("unit").notNull(), defaultPriceCents: integer("default_price_cents").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true), notes: text("notes"), ...timestamps
}, (table) => [index("catalog_description_idx").on(table.description)]);

export const retailerOffers = sqliteTable("retailer_offers", {
  id: text("id").primaryKey(), catalogItemId: text("catalog_item_id").notNull().references(() => catalogItems.id), retailer: text("retailer").notNull(), sku: text("sku"), modelOrUpc: text("model_or_upc"), productUrl: text("product_url"), storeContext: text("store_context"), observedPriceCents: integer("observed_price_cents").notNull(), observedAt: text("observed_at").notNull(), ...timestamps
}, (table) => [index("retailer_offer_catalog_idx").on(table.catalogItemId), uniqueIndex("retailer_offer_identity_uq").on(table.catalogItemId, table.retailer, table.sku, table.storeContext)]);

export const priceHistory = sqliteTable("price_history", {
  id: text("id").primaryKey(), retailerOfferId: text("retailer_offer_id").notNull().references(() => retailerOffers.id), priceCents: integer("price_cents").notNull(), observedAt: text("observed_at").notNull(), source: text("source").notNull().default("manual"), createdAt: text("created_at").notNull()
}, (table) => [index("price_history_offer_idx").on(table.retailerOfferId, table.observedAt)]);

export const jobLineItems = sqliteTable("job_line_items", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull().references(() => jobs.id), catalogItemId: text("catalog_item_id").references(() => catalogItems.id), position: integer("position").notNull(), description: text("description").notNull(), details: text("details"), skuOrModel: text("sku_or_model"), unit: text("unit").notNull(), quantity: real("quantity").notNull(), unitPriceCents: integer("unit_price_cents").notNull(), ...timestamps
}, (table) => [uniqueIndex("job_line_position_uq").on(table.jobId, table.position), index("job_line_job_idx").on(table.jobId)]);

export const estimates = sqliteTable("estimates", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull().references(() => jobs.id), displayId: text("display_id").notNull().unique(), version: integer("version").notNull(), customerSnapshotJson: text("customer_snapshot_json").notNull(), jobSnapshotJson: text("job_snapshot_json").notNull(), notes: text("notes"), subtotalCents: integer("subtotal_cents").notNull(), totalCents: integer("total_cents").notNull(), depositCents: integer("deposit_cents").notNull(), balanceDueCents: integer("balance_due_cents").notNull(), generatedAt: text("generated_at").notNull(), generatedBy: text("generated_by").notNull()
}, (table) => [uniqueIndex("estimate_job_version_uq").on(table.jobId, table.version), index("estimate_job_idx").on(table.jobId)]);

export const estimateLineItems = sqliteTable("estimate_line_items", {
  id: text("id").primaryKey(), estimateId: text("estimate_id").notNull().references(() => estimates.id), sourceLineItemId: text("source_line_item_id"), position: integer("position").notNull(), description: text("description").notNull(), details: text("details"), skuOrModel: text("sku_or_model"), unit: text("unit").notNull(), quantity: real("quantity").notNull(), unitPriceCents: integer("unit_price_cents").notNull(), amountCents: integer("amount_cents").notNull()
}, (table) => [uniqueIndex("estimate_line_position_uq").on(table.estimateId, table.position)]);

export const estimateAdjustments = sqliteTable("estimate_adjustments", {
  estimateId: text("estimate_id").notNull().references(() => estimates.id), kind: text("kind").notNull(), mode: text("mode").notNull(), value: integer("value").notNull(), amountCents: integer("amount_cents").notNull()
}, (table) => [primaryKey({ columns: [table.estimateId, table.kind] })]);

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(), estimateId: text("estimate_id").notNull().references(() => estimates.id), format: text("format").notNull(), objectKey: text("object_key").notNull().unique(), filename: text("filename").notNull(), contentType: text("content_type").notNull(), sizeBytes: integer("size_bytes"), checksumSha256: text("checksum_sha256"), status: text("status").notNull().default("pending"), failureReason: text("failure_reason"), createdAt: text("created_at").notNull()
}, (table) => [uniqueIndex("artifact_estimate_format_uq").on(table.estimateId, table.format)]);

export const counters = sqliteTable("counters", {
  scope: text("scope").primaryKey(), nextValue: integer("next_value").notNull(), updatedAt: text("updated_at").notNull()
});

export const jobMaterials = sqliteTable("job_materials", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull().references(() => jobs.id), catalogItemId: text("catalog_item_id").references(() => catalogItems.id), position: integer("position").notNull(), description: text("description").notNull(), quantity: real("quantity").notNull(), unit: text("unit").notNull(), unitCostCents: integer("unit_cost_cents"), retailer: text("retailer"), skuOrModel: text("sku_or_model"), productUrl: text("product_url"), notes: text("notes"), ...timestamps
}, (table) => [uniqueIndex("job_material_position_uq").on(table.jobId, table.position), index("job_material_job_idx").on(table.jobId)]);

export const estimateDrafts = sqliteTable("estimate_drafts", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull().references(() => jobs.id), notes: text("notes"), sourceEstimateId: text("source_estimate_id").references(() => estimates.id), ...timestamps
}, (table) => [uniqueIndex("estimate_draft_job_uq").on(table.jobId)]);

export const draftCharges = sqliteTable("estimate_draft_charges", {
  id: text("id").primaryKey(), draftId: text("draft_id").notNull().references(() => estimateDrafts.id), position: integer("position").notNull(), description: text("description").notNull(), details: text("details"), amountCents: integer("amount_cents").notNull(), ...timestamps
}, (table) => [uniqueIndex("draft_charge_position_uq").on(table.draftId, table.position), index("draft_charge_draft_idx").on(table.draftId)]);

export const draftAdjustments = sqliteTable("estimate_draft_adjustments", {
  draftId: text("draft_id").notNull().references(() => estimateDrafts.id), kind: text("kind").notNull(), mode: text("mode").notNull(), value: integer("value").notNull()
}, (table) => [primaryKey({ columns: [table.draftId, table.kind] })]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(), valueJson: text("value_json").notNull(), updatedAt: text("updated_at").notNull(), updatedBy: text("updated_by").notNull()
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), actorEmail: text("actor_email").notNull(), action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), metadataJson: text("metadata_json"), createdAt: text("created_at").notNull()
}, (table) => [index("audit_entity_idx").on(table.entityType, table.entityId), index("audit_created_idx").on(table.createdAt)]);
