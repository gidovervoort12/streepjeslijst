const fmt = n => '€' + parseFloat(n).toFixed(2).replace('.', ',');

// Mollie redirects here; get paymentId from sessionStorage (set before redirect)
const paymentId = sessionStorage.getItem('lastPaymentId');
const params = new URLSearchParams(location.search);
const personId = params.get('personId');

async function checkStatus() {
  if (!paymentId) {
    render('unknown');
    return;
  }
  try {
    const r = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`);
    const data = await r.json();
    render(data.status, data.person, data.amount);
    if (data.status === 'open' || data.status === 'pending' || data.status === 'authorized') {
      setTimeout(checkStatus, 2500);
    } else {
      sessionStorage.removeItem('lastPaymentId');
    }
  } catch {
    render('unknown');
  }
}

function render(status, person, amount) {
  const card = document.getElementById('card');
  const name = person?.name ?? '';
  const amountStr = amount ? fmt(amount.value) : '';

  const configs = {
    paid: {
      icon: '✅',
      title: 'Betaling geslaagd!',
      sub: `${name ? `<strong>${name}</strong> heeft ` : ''}${amountStr ? amountStr + ' ' : ''}betaald via iDEAL. De tab is gewist.`,
      btnText: '← Terug naar de lijst',
    },
    open: {
      icon: '⏳',
      title: 'Wachten op betaling…',
      sub: 'De betaling is nog niet bevestigd. Even geduld.',
      btnText: null,
    },
    pending: {
      icon: '⏳',
      title: 'Betaling wordt verwerkt',
      sub: 'Mollie verwerkt de betaling. Dit duurt meestal enkele seconden.',
      btnText: null,
    },
    authorized: {
      icon: '⏳',
      title: 'Betaling goedgekeurd',
      sub: 'De betaling is goedgekeurd en wordt afgerond.',
      btnText: null,
    },
    failed: {
      icon: '❌',
      title: 'Betaling mislukt',
      sub: 'Er is iets misgegaan. Probeer het opnieuw via de lijst.',
      btnText: '← Terug naar de lijst',
    },
    canceled: {
      icon: '↩',
      title: 'Betaling geannuleerd',
      sub: 'De betaling is geannuleerd. Je tab staat nog open.',
      btnText: '← Terug naar de lijst',
    },
    expired: {
      icon: '⏱',
      title: 'Betaling verlopen',
      sub: 'De betaalsessie is verlopen. Probeer het opnieuw.',
      btnText: '← Terug naar de lijst',
    },
    unknown: {
      icon: '❓',
      title: 'Status onbekend',
      sub: 'Kon de betaalstatus niet ophalen.',
      btnText: '← Terug naar de lijst',
    },
  };

  const c = configs[status] ?? configs.unknown;
  const spinning = !c.btnText;

  card.innerHTML = `
    ${spinning ? '<div class="spinner"></div>' : `<div class="icon">${c.icon}</div>`}
    <h1>${c.title}</h1>
    <p class="sub">${c.sub}</p>
    ${amountStr && status === 'paid' ? `<div class="amount">${amountStr}</div><div class="name">${name}</div>` : ''}
    ${c.btnText ? `<a href="/" class="btn">${c.btnText}</a>` : ''}
  `;
}

checkStatus();
