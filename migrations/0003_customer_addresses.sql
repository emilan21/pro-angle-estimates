PRAGMA foreign_keys = ON;

CREATE TABLE customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX customer_address_customer_idx ON customer_addresses(customer_id);
CREATE UNIQUE INDEX customer_address_default_uq ON customer_addresses(customer_id) WHERE is_default = 1;

INSERT INTO customer_addresses(id, customer_id, label, address, is_default, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
       id, 'Default', address, 1, created_at, updated_at
FROM customers
WHERE address IS NOT NULL AND trim(address) <> '';
