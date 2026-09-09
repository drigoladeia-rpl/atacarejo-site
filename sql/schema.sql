CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT DEFAULT '',
  cep TEXT NOT NULL,
  whatsapp TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outros',
  type TEXT NOT NULL DEFAULT 'varejo' CHECK (type IN ('varejo','atacado')),
  factory_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(10,2),
  retail_price NUMERIC(10,2),
  wholesale_price NUMERIC(10,2),
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  description TEXT DEFAULT '',
  specifications TEXT DEFAULT '',
  sizes TEXT DEFAULT '',
  colors TEXT DEFAULT '',
  wholesale_min INTEGER NOT NULL DEFAULT 1,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  shipping_origin TEXT NOT NULL DEFAULT 'own',
  weight_kg NUMERIC(8,3),
  height_cm NUMERIC(8,2),
  width_cm NUMERIC(8,2),
  length_cm NUMERIC(8,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS products_active_idx ON products(active);
CREATE INDEX IF NOT EXISTS products_type_idx ON products(type);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id,sort_order);
CREATE INDEX IF NOT EXISTS suppliers_active_idx ON suppliers(active);

ALTER TABLE products ADD COLUMN IF NOT EXISTS retail_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shipping_origin TEXT NOT NULL DEFAULT 'own';
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(8,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS height_cm NUMERIC(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_cm NUMERIC(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_cm NUMERIC(8,2);
UPDATE products SET retail_price=COALESCE(retail_price,sale_price,ROUND(factory_cost*1.4,2)) WHERE retail_price IS NULL;
