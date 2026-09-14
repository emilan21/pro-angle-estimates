PRAGMA foreign_keys = ON;

CREATE TABLE estimate_drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  notes TEXT,
  source_estimate_id TEXT REFERENCES estimates(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX estimate_draft_job_uq ON estimate_drafts(job_id);

CREATE TABLE estimate_draft_charges (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES estimate_drafts(id),
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  details TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX draft_charge_position_uq ON estimate_draft_charges(draft_id, position);
CREATE INDEX draft_charge_draft_idx ON estimate_draft_charges(draft_id);

CREATE TABLE estimate_draft_adjustments (
  draft_id TEXT NOT NULL REFERENCES estimate_drafts(id),
  kind TEXT NOT NULL CHECK(kind IN ('markup','discount','tax','deposit')),
  mode TEXT NOT NULL CHECK(mode IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK(value >= 0),
  PRIMARY KEY(draft_id, kind)
);

CREATE TABLE job_materials (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  catalog_item_id TEXT REFERENCES catalog_items(id),
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit TEXT NOT NULL,
  unit_cost_cents INTEGER CHECK(unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  retailer TEXT,
  sku_or_model TEXT,
  product_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX job_material_position_uq ON job_materials(job_id, position);
CREATE INDEX job_material_job_idx ON job_materials(job_id);

INSERT INTO job_materials(id, job_id, catalog_item_id, position, description, quantity, unit, unit_cost_cents, sku_or_model, notes, created_at, updated_at)
SELECT id, job_id, catalog_item_id, position, description, quantity, unit, unit_price_cents, sku_or_model, details, created_at, updated_at
FROM job_line_items;
