CREATE TABLE IF NOT EXISTS orders (
 id BIGSERIAL PRIMARY KEY,
 customer_name TEXT NOT NULL,
 customer_phone TEXT NOT NULL,
 customer_email TEXT,
 address_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 payment_method TEXT NOT NULL CHECK(payment_method IN ('pix','cartao','whatsapp')),
 status TEXT NOT NULL DEFAULT 'recebido',
 total NUMERIC(10,2) NOT NULL DEFAULT 0,
 notes TEXT DEFAULT '',
 created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_items (
 id BIGSERIAL PRIMARY KEY,
 order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES products(id),
 product_name TEXT NOT NULL,
 unit_price NUMERIC(10,2) NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 subtotal NUMERIC(10,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
