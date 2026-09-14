import { z } from "zod";

export const nonEmpty = z.string().trim().min(1).max(500);
export const optionalText = z.string().trim().max(4_000).nullish();
export const cents = z.number().int().min(0).max(100_000_000);
export const quantity = z.number().positive().max(1_000_000);

export const customerInput = z.object({
  name: nonEmpty,
  email: z.email().or(z.literal("")).nullish(),
  phone: z.string().trim().max(50).nullish(),
  address: z.string().trim().max(1_000).nullish(),
  notes: optionalText
}).strict();

export const jobInput = z.object({
  customerId: z.uuid(),
  name: nonEmpty,
  address: z.string().trim().max(1_000).nullish(),
  scope: z.string().trim().max(10_000).nullish(),
  notes: optionalText
}).strict();

export const catalogInput = z.object({
  description: nonEmpty,
  unit: nonEmpty.max(40),
  defaultPriceCents: cents,
  active: z.boolean().default(true),
  notes: optionalText
}).strict();

export const retailerOfferInput = z.object({
  catalogItemId: z.uuid(),
  retailer: nonEmpty.max(120),
  sku: z.string().trim().max(120).nullish(),
  modelOrUpc: z.string().trim().max(120).nullish(),
  productUrl: z.url().nullish().or(z.literal("")),
  storeContext: z.string().trim().max(250).nullish(),
  observedPriceCents: cents,
  observedAt: z.iso.datetime()
}).strict();

export const lineItemInput = z.object({
  catalogItemId: z.uuid().nullish(),
  position: z.number().int().min(0),
  description: nonEmpty,
  details: optionalText,
  skuOrModel: z.string().trim().max(250).nullish(),
  unit: nonEmpty.max(40),
  quantity,
  unitPriceCents: cents
}).strict();

export const adjustmentKind = z.enum(["markup", "discount", "tax", "deposit"]);
export const adjustmentInput = z.object({
  kind: adjustmentKind,
  mode: z.enum(["percent", "fixed"]),
  value: z.number().int().min(0).max(100_000_000)
}).strict();

export const estimateGenerationInput = z.object({
  notes: optionalText,
  adjustments: z.array(adjustmentInput).max(4).refine((items) => new Set(items.map((item) => item.kind)).size === items.length, "Each adjustment kind may appear once")
}).strict();

export type CustomerInput = z.infer<typeof customerInput>;
export type JobInput = z.infer<typeof jobInput>;
export type CatalogInput = z.infer<typeof catalogInput>;
export type LineItemInput = z.infer<typeof lineItemInput>;
export type AdjustmentInput = z.infer<typeof adjustmentInput>;

export type EstimateSnapshot = {
  estimateId: string;
  displayId: string;
  version: number;
  generatedAt: string;
  customer: { displayId: string; name: string; email: string | null; phone: string | null; address: string | null };
  job: { displayId: string; name: string; address: string | null; scope: string | null };
  lines: Array<LineItemInput & { id: string; amountCents: number }>;
  adjustments: AdjustmentInput[];
  totals: EstimateTotals;
  notes: string | null;
};

export type EstimateTotals = {
  subtotalCents: number;
  markupCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  balanceDueCents: number;
};
