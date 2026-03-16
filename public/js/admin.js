const fmt = n => '€' + n.toFixed(2).replace('.', ',');
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let persons = [];
let price = 0;

// --- Toast ---
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// --- API ---
async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Fout');
  return data;
}

// --- Collapsible sections ---
const COLLAPSED_KEY = 'adminCollapsed';

function getCollapsed() {
  try { return new Set(JSON.parse(sessionStorage.getItem(COLLAPSED_KEY)) || []); }
  catch { return new Set(); }
}

function saveCollapsed(set) {
  sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
}

function initSections() {
  const collapsed = getCollapsed();
  document.querySelectorAll('.section').forEach(sec => {
    if (collapsed.has(sec.id)) sec.classList.add('collapsed');
  });

  document.querySelectorAll('.section-header[data-sec]').forEach(header => {
    header.addEventListener('click', e => {
      // Don't collapse when clicking a button inside the header
      if (e.target.closest('button')) return;
      const sec = document.getElementById(header.dataset.sec);
      sec.classList.toggle('collapsed');
      const collapsed = getCollapsed();
      if (sec.classList.contains('collapsed')) collapsed.add(sec.id);
      else collapsed.delete(sec.id);
      saveCollapsed(collapsed);
    });
  });
}

// --- Load state ---
async function loadState() {
  const [s, mk] = await Promise.all([api('GET', '/api/state'), api('GET', '/api/mollie-key')]);
  price = s.price;
  persons = s.persons;
  document.getElementById('priceInput').value = price.toFixed(2);
  document.getElementById('currentPrice').textContent = fmt(price);
  updateMollieUI(mk);
  renderPersons();
  renderSnapshots(s.snapshots || []);
  connectSSE();
}

// --- SSE ---
let _es;
function connectSSE() {
  if (_es) _es.close();
  _es = new EventSource('/api/events');
  _es.onmessage = e => {
    const incoming = JSON.parse(e.data);
    price = incoming.price;
    persons = incoming.persons;
    document.getElementById('currentPrice').textContent = fmt(price);
    renderPersons();
    renderSnapshots(incoming.snapshots || []);
  };
  _es.onerror = () => { _es.close(); setTimeout(connectSSE, 3000); };
}

// --- Mollie ---
function updateMollieUI(mk) {
  const status = document.getElementById('mollieStatus');
  const removeBtn = document.getElementById('removeMollieKey');
  if (mk.configured) {
    status.innerHTML = `API-sleutel ingesteld: <strong style="color:var(--accent)">${mk.preview}</strong>`;
    removeBtn.style.display = 'inline-block';
  } else {
    status.innerHTML = `<span style="color:var(--danger)">Nog geen sleutel ingesteld. Betalingen zijn uitgeschakeld.</span>`;
    removeBtn.style.display = 'none';
  }
}

document.getElementById('removeMollieKey').addEventListener('click', async () => {
  if (!confirm('Mollie API-sleutel verwijderen? Betalingen worden uitgeschakeld.')) return;
  try {
    await api('DELETE', '/api/mollie-key');
    showToast('Mollie sleutel verwijderd');
    updateMollieUI({ configured: false });
  } catch (e) { showToast('Fout: ' + e.message); }
});

document.getElementById('saveMollieKey').addEventListener('click', async () => {
  const key = document.getElementById('mollieKeyInput').value.trim();
  const err = document.getElementById('mollieError');
  if (!key) { err.textContent = 'Voer een API-sleutel in.'; return; }
  err.textContent = '';
  try {
    await api('PUT', '/api/mollie-key', { key });
    document.getElementById('mollieKeyInput').value = '';
    showToast('Mollie sleutel opgeslagen');
    updateMollieUI({ configured: true, preview: key.slice(0, 8) + '…' });
  } catch (e) { err.textContent = e.message; }
});

// --- Prijs ---
document.getElementById('savePrice').addEventListener('click', async () => {
  const val = parseFloat(document.getElementById('priceInput').value);
  const err = document.getElementById('priceError');
  if (isNaN(val) || val < 0) { err.textContent = 'Voer een geldige prijs in.'; return; }
  err.textContent = '';
  try {
    const result = await api('PUT', '/api/price', { price: val });
    price = result.price;
    document.getElementById('currentPrice').textContent = fmt(price);
    document.getElementById('priceInput').value = price.toFixed(2);
    showToast('Prijs opgeslagen');
  } catch (e) { err.textContent = e.message; }
});

document.getElementById('priceInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('savePrice').click();
});

// --- Namen ---
function renderPersons() {
  const list = document.getElementById('personsList');
  if (!persons.length) {
    list.innerHTML = '<div class="empty-list">Nog geen namen toegevoegd.</div>';
    return;
  }
  list.innerHTML = persons.map(p => `
    <div class="person-row">
      <span class="person-row-name">${esc(p.name)}</span>
      <span class="person-row-count">${p.count} streepje${p.count !== 1 ? 's' : ''}</span>
      <button class="remove-btn" data-id="${p.id}" title="Verwijderen">✕</button>
    </div>
  `).join('');
}

document.getElementById('addBtn').addEventListener('click', async () => {
  const input = document.getElementById('nameInput');
  const name = input.value.trim();
  const err = document.getElementById('nameError');
  if (!name) { err.textContent = 'Voer een naam in.'; return; }
  err.textContent = '';
  try {
    const p = await api('POST', '/api/persons', { name });
    input.value = '';
    input.focus();
    showToast(`"${p.name}" toegevoegd`);
  } catch (e) {
    err.textContent = e.message === 'Name already exists' ? 'Naam bestaat al.' : e.message;
  }
});

document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addBtn').click();
});

document.getElementById('personsList').addEventListener('click', async e => {
  const btn = e.target.closest('.remove-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  const person = persons.find(p => p.id == id);
  if (!confirm(`"${person?.name}" verwijderen?`)) return;
  try {
    await api('DELETE', `/api/persons/${id}`);
    showToast('Persoon verwijderd');
  } catch (e) { showToast('Fout: ' + e.message); }
});

// --- Snapshots ---
function renderSnapshots(snapshots) {
  const list = document.getElementById('snapshotList');
  if (!snapshots.length) {
    list.innerHTML = '<div class="empty-list">Geen momentopnames gevonden.</div>';
    return;
  }
  // Preserve open state across re-renders
  const openIds = new Set(
    [...document.querySelectorAll('.snapshot-entry.open')].map(el => el.dataset.id)
  );
  list.innerHTML = snapshots.map(s => {
    const total = s.persons.reduce((n, p) => n + p.count, 0);
    const pills = s.persons
      .filter(p => p.count > 0)
      .map(p => `<span class="snapshot-pill">${esc(p.name)} <span class="pill-count">${p.count}</span></span>`)
      .join('');
    const isOpen = openIds.has(String(s.id));
    return `
      <div class="snapshot-entry ${isOpen ? 'open' : ''}" data-id="${s.id}">
        <button class="snapshot-header" data-toggle="${s.id}">
          <span class="snapshot-label">${esc(s.label)}</span>
          <span class="snapshot-total">${total} streepje${total !== 1 ? 's' : ''}</span>
          <span class="snapshot-chevron">▼</span>
        </button>
        <div class="snapshot-body">
          <div class="snapshot-persons">${pills || '<span style="color:var(--text-muted);font-size:0.85rem">Geen streepjes</span>'}</div>
          <div class="snapshot-actions">
            <button class="btn-restore" data-restore="${s.id}">↩ Herstel</button>
            <button class="btn-danger-ghost" data-delete-snap="${s.id}">Verwijderen</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

document.getElementById('snapshotList').addEventListener('click', async e => {
  const toggleBtn = e.target.closest('[data-toggle]');
  const restoreBtn = e.target.closest('[data-restore]');
  const deleteBtn = e.target.closest('[data-delete-snap]');

  if (toggleBtn) {
    toggleBtn.closest('.snapshot-entry').classList.toggle('open');
    return;
  }
  if (restoreBtn) {
    if (!confirm('Streepjes herstellen naar deze momentopname?')) return;
    try {
      await api('POST', `/api/snapshots/${restoreBtn.dataset.restore}/restore`);
      showToast('Stand hersteld');
    } catch (e) { showToast('Fout: ' + e.message); }
    return;
  }
  if (deleteBtn) {
    if (!confirm('Deze momentopname verwijderen?')) return;
    try {
      await api('DELETE', `/api/snapshots/${deleteBtn.dataset.deleteSnap}`);
      showToast('Momentopname verwijderd');
    } catch (e) { showToast('Fout: ' + e.message); }
  }
});

document.getElementById('takeSnapshotBtn').addEventListener('click', async e => {
  e.stopPropagation(); // prevent section collapse toggle
  try {
    await api('POST', '/api/snapshots', {});
    showToast('Momentopname opgeslagen');
  } catch (e) { showToast('Fout: ' + e.message); }
});

// --- Beheeracties ---
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Alle streepjes wissen?')) return;
  await api('POST', '/api/reset');
  showToast('Alle streepjes gewist');
});

document.getElementById('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('Alle namen permanent verwijderen?')) return;
  await Promise.all(persons.map(p => api('DELETE', `/api/persons/${p.id}`)));
  showToast('Alle namen verwijderd');
});

// --- Password gate ---
const ADMIN_PW = '123qwe123';
const SESSION_KEY = 'adminUnlocked';

function unlock() {
  document.getElementById('pwGate').style.display = 'none';
  document.getElementById('pageContent').classList.add('unlocked');
  initSections();
  loadState();
}

if (sessionStorage.getItem(SESSION_KEY) === '1') {
  unlock();
}

document.getElementById('pwSubmit').addEventListener('click', () => {
  const val = document.getElementById('pwInput').value;
  if (val === ADMIN_PW) {
    sessionStorage.setItem(SESSION_KEY, '1');
    unlock();
  } else {
    const err = document.getElementById('pwError');
    err.textContent = 'Onjuist wachtwoord.';
    document.getElementById('pwInput').value = '';
    document.getElementById('pwInput').focus();
    setTimeout(() => err.textContent = '', 2500);
  }
});

document.getElementById('pwInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pwSubmit').click();
});

if (!sessionStorage.getItem(SESSION_KEY)) {
  setTimeout(() => document.getElementById('pwInput').focus(), 50);
}
