PRAGMA foreign_keys = ON;

ALTER TABLE customer_addresses ADD COLUMN address_line_1 TEXT;
ALTER TABLE customer_addresses ADD COLUMN address_line_2 TEXT;
ALTER TABLE customer_addresses ADD COLUMN city TEXT;
ALTER TABLE customer_addresses ADD COLUMN state TEXT;
ALTER TABLE customer_addresses ADD COLUMN postal_code TEXT;

UPDATE customer_addresses
SET address_line_1 = address
WHERE address_line_1 IS NULL AND trim(address) <> '';

ALTER TABLE jobs ADD COLUMN address_line_1 TEXT;
ALTER TABLE jobs ADD COLUMN address_line_2 TEXT;
ALTER TABLE jobs ADD COLUMN city TEXT;
ALTER TABLE jobs ADD COLUMN state TEXT;
ALTER TABLE jobs ADD COLUMN postal_code TEXT;

UPDATE jobs
SET address_line_1 = address
WHERE address_line_1 IS NULL AND address IS NOT NULL AND trim(address) <> '';
