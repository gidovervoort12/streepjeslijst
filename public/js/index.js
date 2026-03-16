let state = { price: 0, persons: [] };
const undoStack = []; // [{ id, reverseDelta }]

const fmt = n => '€' + n.toFixed(2).replace('.', ',');
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// --- Pin (per device via localStorage) ---
const PIN_KEY = 'streepjeslijst_pinned';
let pinnedId = localStorage.getItem(PIN_KEY) ? parseInt(localStorage.getItem(PIN_KEY)) : null;

function setPinned(id) {
  if (pinnedId === id) {
    pinnedId = null;
    localStorage.removeItem(PIN_KEY);
  } else {
    pinnedId = id;
    localStorage.setItem(PIN_KEY, String(id));
  }
  render();
}

// --- Search & fuzzy match ---
let searchQuery = '';

function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '');
}

function fuzzyMatch(needle, haystack) {
  const n = normalize(needle);
  const h = normalize(haystack);
  if (!n) return true;
  if (h.includes(n)) return true;
  if (n.length < 2) return false;
  // tolerate 1 missing/wrong character
  for (let i = 0; i < n.length; i++) {
    if (h.includes(n.slice(0, i) + n.slice(i + 1))) return true;
  }
  for (let i = 0; i <= h.length - n.length; i++) {
    let diffs = 0;
    for (let j = 0; j < n.length; j++) {
      if (h[i + j] !== n[j] && ++diffs > 1) break;
    }
    if (diffs <= 1) return true;
  }
  return false;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function syncUndoBtn() {
  document.getElementById('undoBtn').classList.toggle('visible', undoStack.length > 0);
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function loadMollieFlag() {
  const mk = await api('GET', '/api/mollie-key');
  state.mollieConfigured = mk.configured;
}

function connectSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = e => {
    const incoming = JSON.parse(e.data);
    state = { ...incoming, mollieConfigured: state.mollieConfigured ?? false };
    render();
  };
  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 3000); // reconnect after 3s
  };
}

function render() {
  document.getElementById('priceDisplay').textContent = fmt(state.price);
  const list = document.getElementById('personList');
  const summary = document.getElementById('summarySection');

  if (!state.persons.length) {
    list.innerHTML = `<div class="empty"><div class="icon">🍺</div>Geen namen op de lijst.<br><a href="/admin.html">Voeg namen toe via Admin</a>.</div>`;
    summary.style.display = 'none';
    return;
  }

  // Sort: pinned first, then alphabetical
  const sorted = [...state.persons].sort((a, b) => {
    if (a.id === pinnedId) return -1;
    if (b.id === pinnedId) return 1;
    return a.name.localeCompare(b.name, 'nl');
  });

  // Filter by search query
  const filtered = searchQuery ? sorted.filter(p => fuzzyMatch(searchQuery, p.name)) : sorted;

  if (!filtered.length) {
    list.innerHTML = `<div class="empty" style="padding:1.5rem">Geen resultaten voor "<strong>${esc(searchQuery)}</strong>"</div>`;
    summary.style.display = 'block';
  } else {
    list.innerHTML = filtered.map(p => {
      const pinned = p.id === pinnedId;
      const hasPending = p.payment && p.payment.status !== 'paid';
      const payBtn = p.count > 0 && state.mollieConfigured
        ? `<button class="pay-btn ${hasPending ? 'pending' : ''}" data-id="${p.id}" data-action="pay" ${hasPending ? 'disabled title="Betaling loopt…"' : ''}>
            ${hasPending ? '⏳ Bezig…' : 'iDEAL ' + fmt(p.count * state.price)}
           </button>`
        : '';
      return `
      <div class="person-card ${pinned ? 'pinned' : ''}">
        <button class="pin-btn" data-action="pin" data-id="${p.id}" title="${pinned ? 'Losmaken' : 'Vastzetten'}">📌</button>
        <span class="person-name">${esc(p.name)}</span>
        <div class="tally-controls">
          <button class="tally-btn minus" data-id="${p.id}" data-action="dec" ${p.count === 0 ? 'disabled' : ''}>−</button>
          <span class="tally-count">${p.count}</span>
          <button class="tally-btn plus" data-id="${p.id}" data-action="inc">+</button>
        </div>
        <button class="cost-toggle" data-action="cost" data-id="${p.id}" title="Toon/verberg bedrag">€</button>
        <span class="person-cost">${fmt(p.count * state.price)}</span>
        ${payBtn}
      </div>`;
    }).join('');
  }

  const drinks = state.persons.reduce((s, p) => s + p.count, 0);
  document.getElementById('totalDrinks').textContent = drinks + (drinks === 1 ? ' consumptie' : ' consumpties');
  document.getElementById('totalAmount').textContent = fmt(drinks * state.price);
  summary.style.display = 'block';
}

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  render();
});

document.getElementById('personList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const id = parseInt(btn.dataset.id);
  if (btn.dataset.action === 'pin') { setPinned(id); return; }
  if (btn.dataset.action === 'cost') {
    btn.closest('.person-card').classList.toggle('cost-open');
    return;
  }
  const delta = btn.dataset.action === 'inc' ? 1 : -1;
  try {
    const updated = await api('PATCH', `/api/persons/${id}`, { delta });
    const p = state.persons.find(x => x.id === id);
    if (p) {
      if (updated.count !== p.count) {
        undoStack.push({ id, reverseDelta: -delta });
        syncUndoBtn();
      }
      p.count = updated.count;
      render();
    }
  } catch {}
});

document.getElementById('personList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action="pay"]');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Laden…';
  try {
    const { checkoutUrl, paymentId } = await api('POST', '/api/payments', { personId: btn.dataset.id });
    // Store paymentId so return page can use it
    sessionStorage.setItem('lastPaymentId', paymentId);
    window.location.href = checkoutUrl;
  } catch (e) {
    showToast('Fout: ' + e.message);
    await loadMollieFlag();
    render();
  }
}, true); // capture so it runs before the tally handler

document.getElementById('addSelfForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('addSelfInput');
  const err = document.getElementById('addSelfError');
  const name = input.value.trim();
  if (!name) return;
  err.textContent = '';
  try {
    await api('POST', '/api/persons', { name });
    input.value = '';
    showToast(`"${name}" toegevoegd`);
  } catch (ex) {
    err.textContent = ex.message === 'Name already exists' ? 'Naam staat er al op.' : ex.message;
  }
});

document.getElementById('undoBtn').addEventListener('click', async () => {
  if (!undoStack.length) return;
  const { id, reverseDelta } = undoStack.pop();
  syncUndoBtn();
  try {
    const updated = await api('PATCH', `/api/persons/${id}`, { delta: reverseDelta });
    const p = state.persons.find(x => x.id == id);
    if (p) { p.count = updated.count; render(); }
    const name = state.persons.find(x => x.id == id)?.name ?? '';
    showToast(`Ongedaan: ${reverseDelta > 0 ? '+' : ''}${reverseDelta} voor ${name}`);
  } catch {
    // Re-push if failed
    undoStack.push({ id, reverseDelta });
    syncUndoBtn();
  }
});

// Hamburger menu
const hamburgerBtn = document.getElementById('hamburgerBtn');
const navMenu = document.getElementById('navMenu');

hamburgerBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = navMenu.classList.toggle('open');
  hamburgerBtn.classList.toggle('open', open);
});

document.addEventListener('click', () => {
  navMenu.classList.remove('open');
  hamburgerBtn.classList.remove('open');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    navMenu.classList.remove('open');
    hamburgerBtn.classList.remove('open');
  }
});

loadMollieFlag().then(connectSSE);
