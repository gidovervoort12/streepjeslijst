const express = require('express');
const { DatabaseSync } = require('node:sqlite');
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
  INSERT OR IGNORE INTO settings (key, value) VALUES ('price', '2.50');
`);

// --- Helpers ---
const getPrice = () => parseFloat(db.prepare(`SELECT value FROM settings WHERE key='price'`).get().value);

// --- API ---

// Get full state
app.get('/api/state', (req, res) => {
  const price = getPrice();
  const persons = db.prepare('SELECT id, name, count FROM persons ORDER BY name COLLATE NOCASE').all();
  res.json({ price, persons });
});

// Add person
app.post('/api/persons', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const exists = db.prepare('SELECT id FROM persons WHERE name = ? COLLATE NOCASE').get(name);
  if (exists) return res.status(409).json({ error: 'Name already exists' });
  const info = db.prepare('INSERT INTO persons (name) VALUES (?)').run(name);
  res.status(201).json({ id: info.lastInsertRowid, name, count: 0 });
});

// Delete person
app.delete('/api/persons/:id', (req, res) => {
  db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Update tally (delta: +1 or -1)
app.patch('/api/persons/:id', (req, res) => {
  const delta = req.body.delta === -1 ? -1 : 1;
  db.prepare('UPDATE persons SET count = MAX(0, count + ?) WHERE id = ?').run(delta, req.params.id);
  const person = db.prepare('SELECT id, name, count FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Not found' });
  res.json(person);
});

// Update price
app.put('/api/price', (req, res) => {
  const price = parseFloat(req.body.price);
  if (isNaN(price) || price < 0) return res.status(400).json({ error: 'Invalid price' });
  const rounded = Math.round(price * 100) / 100;
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'price'`).run(String(rounded));
  res.json({ price: rounded });
});

// Reset all tallies
app.post('/api/reset', (req, res) => {
  db.prepare('UPDATE persons SET count = 0').run();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Streepjeslijst running at http://localhost:${PORT}`));
