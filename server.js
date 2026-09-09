require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const uploadDir = path.join(publicDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? undefined : { rejectUnauthorized: false }
});

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))
});

function retail(p) {
  const n = Number(p.retail_price ?? p.sale_price);
  return Number.isFinite(n) && n > 0 ? n : Number(p.factory_cost || 0) * 1.4;
}
function wholesale(p) {
  return p.wholesale_price == null ? null : Number(p.wholesale_price);
}
function tokenFor(email) {
  return jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '8h' });
}
function auth(req, res, next) {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada' });
  }
}
function cleanCep(v) {
  return String(v || '').replace(/\D/g, '').slice(0, 8);
}
function normalizeCep(v) {
  const d = cleanCep(v);
  return d.length === 8 ? `${d.slice(0,5)}-${d.slice(5)}` : String(v || '');
}

async function productPayload(rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const supplierIds = rows.map(r => r.supplier_id).filter(Boolean);
  const [images, suppliers] = await Promise.all([
    pool.query('SELECT product_id,url,sort_order FROM product_images WHERE product_id=ANY($1::int[]) ORDER BY sort_order,id', [ids]),
    supplierIds.length ? pool.query('SELECT id,name,company_name,cep,whatsapp,notes,active FROM suppliers WHERE id=ANY($1::int[])', [supplierIds]) : { rows: [] }
  ]);
  const imageMap = new Map();
  for (const img of images.rows) {
    if (!imageMap.has(img.product_id)) imageMap.set(img.product_id, []);
    imageMap.get(img.product_id).push(img.url);
  }
  const supplierMap = new Map(suppliers.rows.map(s => [s.id, s]));
  return rows.map(p => ({
    ...p,
    retail_price: retail(p),
    wholesale_price: wholesale(p),
    images: imageMap.get(p.id) || (p.image ? [p.image] : []),
    supplier: p.supplier_id ? supplierMap.get(p.supplier_id) || null : null
  }));
}

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const q = await pool.query('SELECT * FROM admins WHERE email=$1', [email]);
    if (!q.rowCount || !await bcrypt.compare(password || '', q.rows[0].password_hash)) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }
    res.cookie('admin_token', tokenFor(email), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro no login' });
  }
});
app.post('/api/logout', (req, res) => { res.clearCookie('admin_token'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ email: req.admin.email }));

app.get('/api/products', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM products WHERE active=true ORDER BY created_at DESC');
    res.json(await productPayload(q.rows));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products/:id', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM products WHERE id=$1 AND active=true', [req.params.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json((await productPayload(q.rows))[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/products', auth, async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json(await productPayload(q.rows));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/suppliers', auth, async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM suppliers ORDER BY active DESC,name ASC');
    res.json(q.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/suppliers', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const cep = normalizeCep(b.cep);
    if (!b.name || !/^\d{5}-\d{3}$/.test(cep)) return res.status(400).json({ error: 'Nome e CEP válido são obrigatórios' });
    const q = await pool.query(
      'INSERT INTO suppliers(name,company_name,cep,whatsapp,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [b.name.trim(), b.company_name || '', cep, b.whatsapp || '', b.notes || '']
    );
    res.json(q.rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/suppliers/:id', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const cep = normalizeCep(b.cep);
    if (!b.name || !/^\d{5}-\d{3}$/.test(cep)) return res.status(400).json({ error: 'Nome e CEP válido são obrigatórios' });
    const q = await pool.query(
      'UPDATE suppliers SET name=$1,company_name=$2,cep=$3,whatsapp=$4,notes=$5,updated_at=NOW() WHERE id=$6 RETURNING *',
      [b.name.trim(), b.company_name || '', cep, b.whatsapp || '', b.notes || '', req.params.id]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    res.json(q.rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/suppliers/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE suppliers SET active=false,updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

async function saveImages(productId, files, firstImage) {
  if (firstImage) await pool.query('UPDATE products SET image=$1 WHERE id=$2', [firstImage, productId]);
  if (!files?.length) return;
  const start = Number((await pool.query(
    'SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM product_images WHERE product_id=$1', [productId]
  )).rows[0].n);
  for (let i = 0; i < files.length; i++) {
    await pool.query('INSERT INTO product_images(product_id,url,sort_order) VALUES($1,$2,$3)', [productId, `/uploads/${files[i].filename}`, start + i]);
  }
}

function productValues(b, files) {
  const first = files[0] ? `/uploads/${files[0].filename}` : (b.image || '');
  const retailPrice = b.retail_price === '' || b.retail_price == null ? null : Number(b.retail_price);
  const wholesalePrice = b.wholesale_price === '' || b.wholesale_price == null ? null : Number(b.wholesale_price);
  return [
    b.name, b.category || 'Outros', b.type || 'varejo', Number(b.factory_cost) || 0,
    retailPrice, retailPrice, wholesalePrice, parseInt(b.stock, 10) || 0, first,
    b.description || '', b.specifications || '', b.sizes || '', b.colors || '',
    parseInt(b.wholesale_min, 10) || 1, b.supplier_id ? Number(b.supplier_id) : null,
    b.shipping_origin || 'own', b.weight_kg === '' ? null : Number(b.weight_kg),
    b.height_cm === '' ? null : Number(b.height_cm), b.width_cm === '' ? null : Number(b.width_cm),
    b.length_cm === '' ? null : Number(b.length_cm)
  ];
}

const productColumns = 'name,category,type,factory_cost,sale_price,retail_price,wholesale_price,stock,image,description,specifications,sizes,colors,wholesale_min,supplier_id,shipping_origin,weight_kg,height_cm,width_cm,length_cm';
const placeholders = Array.from({ length: 20 }, (_, i) => `$${i + 1}`).join(',');

app.post('/api/products', auth, upload.array('images', 8), async (req, res) => {
  try {
    const b = req.body || {}; const files = req.files || [];
    if (!b.name) return res.status(400).json({ error: 'Nome do produto é obrigatório' });
    const values = productValues(b, files);
    const q = await pool.query(`INSERT INTO products(${productColumns}) VALUES(${placeholders}) RETURNING *`, values);
    await saveImages(q.rows[0].id, files, values[8]);
    res.json((await productPayload(q.rows))[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/products/:id', auth, upload.array('images', 8), async (req, res) => {
  try {
    const old = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!old.rowCount) return res.status(404).json({ error: 'Produto não encontrado' });
    const b = req.body || {}; const files = req.files || [];
    const oldp = old.rows[0];
    const values = productValues(b, files);
    if (!files.length && !b.image) values[8] = oldp.image || '';
    const set = productColumns.split(',').map((c, i) => `${c}=$${i + 1}`).join(',');
    const q = await pool.query(`UPDATE products SET ${set},updated_at=NOW() WHERE id=$21 RETURNING *`, [...values, req.params.id]);
    await saveImages(req.params.id, files, values[8]);
    res.json((await productPayload(q.rows))[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/products/:id', auth, async (req, res) => {
  try { await pool.query('UPDATE products SET active=false,updated_at=NOW() WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/shipping/origins', async (req, res) => {
  try {
    const q = await pool.query('SELECT id,name,cep FROM suppliers WHERE active=true ORDER BY name');
    res.json({ own: { name: 'Meu estoque', cep: normalizeCep(process.env.OWN_STOCK_CEP || '37795-970') }, suppliers: q.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shipping/quote', async (req, res) => {
  try {
    const destination = normalizeCep(req.body?.destination_cep);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!/^\d{5}-\d{3}$/.test(destination)) return res.status(400).json({ error: 'Informe um CEP de destino válido' });
    if (!items.length) return res.status(400).json({ error: 'Carrinho vazio' });
    const ids = items.map(i => Number(i.product_id)).filter(Number.isInteger);
    const q = await pool.query('SELECT id,name,shipping_origin,supplier_id,weight_kg,height_cm,width_cm,length_cm FROM products WHERE id=ANY($1::int[]) AND active=true', [ids]);
    const supplierIds = q.rows.map(p => p.supplier_id).filter(Boolean);
    const suppliers = supplierIds.length ? await pool.query('SELECT id,name,cep FROM suppliers WHERE id=ANY($1::int[])', [supplierIds]) : { rows: [] };
    const sm = new Map(suppliers.rows.map(s => [s.id, s]));
    const groups = new Map();
    for (const p of q.rows) {
      const item = items.find(i => Number(i.product_id) === p.id);
      const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
      const isSupplier = p.shipping_origin === 'supplier' && p.supplier_id && sm.has(p.supplier_id);
      const key = isSupplier ? `supplier:${p.supplier_id}` : 'own';
      if (!groups.has(key)) {
        const supplier = isSupplier ? sm.get(p.supplier_id) : null;
        groups.set(key, {
          origin_key: key,
          origin_name: supplier?.name || 'Meu estoque',
          origin_cep: supplier?.cep || normalizeCep(process.env.OWN_STOCK_CEP || '37795-970'),
          supplier_id: supplier?.id || null,
          items: [], total_weight: 0
        });
      }
      const g = groups.get(key);
      g.items.push({ product_id: p.id, name: p.name, quantity });
      g.total_weight += Number(p.weight_kg || 0) * quantity;
    }
    res.json({
      destination_cep: destination,
      shipments: [...groups.values()],
      total: null,
      status: 'aguardando_provedor',
      note: 'As remessas já são separadas por origem. O preço e o prazo reais dependem da integração com o provedor de frete (ex.: Melhor Envio/Correios).'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items, payment_method = 'whatsapp', notes = '', shipping_total = 0 } = req.body || {};
    if (!customer?.name || !customer?.phone || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Dados do pedido incompletos' });
    const ids = items.map(i => Number(i.product_id)).filter(Number.isInteger);
    const q = await pool.query('SELECT * FROM products WHERE id=ANY($1::int[]) AND active=true', [ids]);
    const map = new Map(q.rows.map(p => [p.id, p]));
    let subtotal = 0; const rows = [];
    for (const item of items) {
      const p = map.get(Number(item.product_id)); const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      if (!p || Number(p.stock) < qty) return res.status(400).json({ error: 'Produto sem estoque ou quantidade indisponível: ' + (p?.name || item.product_id) });
      const unit = retail(p); const sub = unit * qty; subtotal += sub; rows.push({ p, qty, unit, sub });
    }
    const shipping = Math.max(0, Number(shipping_total) || 0); const total = subtotal + shipping;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const o = await client.query(
        'INSERT INTO orders(customer_name,customer_phone,customer_email,address_json,payment_method,total,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [customer.name, customer.phone, customer.email || '', customer.address || {}, payment_method, total, notes]
      );
      for (const r of rows) {
        await client.query('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal) VALUES($1,$2,$3,$4,$5,$6)', [o.rows[0].id, r.p.id, r.p.name, r.unit, r.qty, r.sub]);
        await client.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2', [r.qty, r.p.id]);
      }
      await client.query('COMMIT'); res.json({ order: o.rows[0], subtotal, shipping, total });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/admin/orders', auth, async (req, res) => {
  try {
    const q = await pool.query("SELECT o.*,COALESCE(json_agg(json_build_object('product_id',i.product_id,'name',i.product_name,'quantity',i.quantity,'unit_price',i.unit_price)) FILTER (WHERE i.id IS NOT NULL),'[]') items FROM orders o LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC");
    res.json(q.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/admin/orders/:id', auth, async (req, res) => {
  const allowed = ['recebido','confirmado','pago','enviado','concluido','cancelado'];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: 'Status inválido' });
  try { const q = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]); res.json(q.rows[0]); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.use(express.static(publicDir));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin-login.html')));

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'sql/schema.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname, 'sql/orders.sql'), 'utf8'));
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await pool.query('INSERT INTO admins(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash', [process.env.ADMIN_EMAIL, hash]);
  }
}

init().then(() => app.listen(port, () => console.log(`ATACAREJO online na porta ${port}`))).catch(err => { console.error(err); process.exit(1); });
