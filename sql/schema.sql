CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outros',
  type TEXT NOT NULL DEFAULT 'varejo' CHECK (type IN ('varejo','atacado')),
  factory_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(10,2),
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  description TEXT DEFAULT '',
  specifications TEXT DEFAULT '',
  sizes TEXT DEFAULT '',
  colors TEXT DEFAULT '',
  wholesale_min INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_active_idx ON products(active);
CREATE INDEX IF NOT EXISTS products_type_idx ON products(type);
