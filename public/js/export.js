const fmt = n => '€' + n.toFixed(2).replace('.', ',');
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let exportData = { price: 0, persons: [] };

function formatDate(d) {
  return d.toLocaleString('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function load() {
  const state = await fetch('/api/state').then(r => r.json());
  exportData = state;
  render(state);
}

function render(state) {
  const now = new Date();
  document.getElementById('docDate').textContent = 'Geëxporteerd op: ' + formatDate(now);
  document.getElementById('docPrice').textContent = 'Prijs per consumptie: ' + fmt(state.price);

  const persons = state.persons;
  const maxCount = Math.max(...persons.map(p => p.count), 1);
  const totalDrinks = persons.reduce((s, p) => s + p.count, 0);
  const totalAmount = totalDrinks * state.price;

  if (!persons.length) {
    document.getElementById('tableWrap').innerHTML = '<p class="empty-state">Geen namen op de lijst.</p>';
    return;
  }

  document.getElementById('tableWrap').innerHTML = `
    <table class="tally-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Naam</th>
          <th class="num">Consumpties</th>
          <th class="bar-cell"></th>
          <th class="num">Bedrag</th>
        </tr>
      </thead>
      <tbody>
        ${persons.map((p, i) => `
          <tr>
            <td style="color:var(--text-muted);font-size:0.8rem">${i + 1}</td>
            <td class="td-name">${esc(p.name)}</td>
            <td class="td-count num">${p.count}</td>
            <td class="bar-cell">
              <div class="bar-track">
                <div class="bar-fill" style="width:${Math.round(p.count / maxCount * 100)}%"></div>
              </div>
            </td>
            <td class="td-amount num">${fmt(p.count * state.price)}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td></td>
          <td class="foot-label">Totaal</td>
          <td class="num foot-total">${totalDrinks}</td>
          <td class="bar-cell"></td>
          <td class="num foot-total">${fmt(totalAmount)}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

document.getElementById('printBtn').addEventListener('click', () => window.print());

load();
