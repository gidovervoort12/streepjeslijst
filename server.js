const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { createMollieClient } = require('@mollie/api-client');
const path = require('path');

const app = express();
const db = new DatabaseSync(path.join(__dirname, 'streepjeslijst.db'));

app.use(express.json());
app.use(express.static(__dirname));

// --- DB setup ---
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS persons (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS payments (
    id         TEXT PRIMARY KEY,
    person_id  INTEGER NOT NULL,
    amount     REAL NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('price', '2.50');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('mollie_key', '');
`);

// --- Helpers ---
const getPrice = () => parseFloat(db.prepare(`SELECT value FROM settings WHERE key='price'`).get().value);

function getState() {
  const price = getPrice();
  const persons = db.prepare('SELECT id, name, count FROM persons ORDER BY name COLLATE NOCASE').all();
  const openPayments = db.prepare(`SELECT person_id, id, status FROM payments WHERE status IN ('open','pending','authorized') ORDER BY created_at DESC`).all();
  const paymentByPerson = {};
  for (const p of openPayments) {
    if (!paymentByPerson[p.person_id]) paymentByPerson[p.person_id] = p;
  }
  return { price, persons: persons.map(p => ({ ...p, payment: paymentByPerson[p.id] || null })) };
}

function getMollie() {
  const row = db.prepare(`SELECT value FROM settings WHERE key='mollie_key'`).get();
  const key = row?.value?.trim();
  if (!key) throw new Error('Mollie API key not configured');
  return createMollieClient({ apiKey: key });
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// --- SSE broadcast ---
const sseClients = new Set();

function broadcast() {
  if (!sseClients.size) return;
  const data = JSON.stringify(getState());
  for (const res of sseClients) {
    res.write(`data: ${data}\n\n`);
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify(getState())}\n\n`);

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// --- API ---

app.get('/api/state', (req, res) => res.json(getState()));

// Add person
app.post('/api/persons', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const exists = db.prepare('SELECT id FROM persons WHERE name = ? COLLATE NOCASE').get(name);
  if (exists) return res.status(409).json({ error: 'Name already exists' });
  const info = db.prepare('INSERT INTO persons (name) VALUES (?)').run(name);
  broadcast();
  res.status(201).json({ id: info.lastInsertRowid, name, count: 0 });
});

// Delete person
app.delete('/api/persons/:id', (req, res) => {
  db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  broadcast();
  res.json({ ok: true });
});

// Update tally (delta: +1 or -1)
app.patch('/api/persons/:id', (req, res) => {
  const delta = req.body.delta === -1 ? -1 : 1;
  db.prepare('UPDATE persons SET count = MAX(0, count + ?) WHERE id = ?').run(delta, req.params.id);
  const person = db.prepare('SELECT id, name, count FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Not found' });
  broadcast();
  res.json(person);
});

// Update price
app.put('/api/price', (req, res) => {
  const price = parseFloat(req.body.price);
  if (isNaN(price) || price < 0) return res.status(400).json({ error: 'Invalid price' });
  const rounded = Math.round(price * 100) / 100;
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'price'`).run(String(rounded));
  broadcast();
  res.json({ price: rounded });
});

// Reset all tallies
app.post('/api/reset', (req, res) => {
  db.prepare('UPDATE persons SET count = 0').run();
  broadcast();
  res.json({ ok: true });
});

// --- Mollie API key (admin) ---
app.get('/api/mollie-key', (req, res) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key='mollie_key'`).get();
  const key = row?.value?.trim() || '';
  res.json({ configured: !!key, preview: key ? key.slice(0, 8) + '…' : null });
});

app.put('/api/mollie-key', (req, res) => {
  const key = (req.body.key || '').trim();
  if (!key) return res.status(400).json({ error: 'Key is required' });
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'mollie_key'`).run(key);
  broadcast();
  res.json({ ok: true });
});

// --- Payments ---

app.post('/api/payments', async (req, res) => {
  try {
    const mollie = getMollie();
    const personId = parseInt(req.body.personId, 10);
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId);
    if (!person) return res.status(404).json({ error: 'Person not found' });

    const price = getPrice();
    const amount = Math.round(person.count * price * 100) / 100;
    if (amount <= 0) return res.status(400).json({ error: 'Niets te betalen' });

    const payment = await mollie.payments.create({
      amount: { currency: 'EUR', value: amount.toFixed(2) },
      description: `Streepjeslijst – ${person.name} (${person.count}x)`,
      redirectUrl: `${baseUrl(req)}/return.html?personId=${personId}`,
      webhookUrl: `${baseUrl(req)}/api/webhooks/mollie`,
      method: 'ideal',
      metadata: { personId: String(personId) },
    });

    db.prepare('INSERT OR REPLACE INTO payments (id, person_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
      payment.id, personId, amount, payment.status, Date.now()
    );

    broadcast();
    res.json({ checkoutUrl: payment._links.checkout.href, paymentId: payment.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/payments/:id', async (req, res) => {
  try {
    const mollie = getMollie();
    const payment = await mollie.payments.get(req.params.id);
    db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(payment.status, payment.id);

    const personId = payment.metadata?.personId
      ? parseInt(payment.metadata.personId, 10)
      : db.prepare('SELECT person_id FROM payments WHERE id = ?').get(payment.id)?.person_id;

    if (payment.status === 'paid' && personId) {
      db.prepare('UPDATE persons SET count = 0 WHERE id = ?').run(personId);
      broadcast();
    }

    const person = personId ? db.prepare('SELECT id, name, count FROM persons WHERE id = ?').get(personId) : null;
    res.json({ status: payment.status, personId, person, amount: payment.amount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/webhooks/mollie', async (req, res) => {
  try {
    const id = req.body.id;
    if (!id) return res.sendStatus(200);
    const mollie = getMollie();
    const payment = await mollie.payments.get(id);
    db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(payment.status, id);
    if (payment.status === 'paid') {
      const personId = payment.metadata?.personId;
      if (personId) db.prepare('UPDATE persons SET count = 0 WHERE id = ?').run(parseInt(personId, 10));
      broadcast();
    }
  } catch {}
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Streepjeslijst running at http://localhost:${PORT}`));
