(function(){
  try {
    const KEY = 'muiwow-cart';
    const t = JSON.parse(localStorage.getItem(KEY) || '{}');
    const slugs = Object.keys(t);
    const items = document.querySelector('.cart-items');
    let probe = 'fetched, items=' + !!items;
    items.textContent = '';
    const ce = document.querySelector('.cart-empty');
    ce.hidden = slugs.length > 0;
    const fab = document.querySelector('[data-cart-open]');
    fab.hidden = false;
    const badge = document.querySelector('[data-cart-badge]');
    const count = Object.values(t).reduce((a, b) => a + b.qty, 0);
    badge.textContent = String(count);
    let total = 0;
    for (const s of slugs) {
      const row = document.createElement('div');
      row.className = 'cart-row';
      row.innerHTML = `<div><div class="cart-name">${t[s].name}</div><div class="cart-line">${t[s].price} × ${t[s].qty}</div></div>`;
      probe += ' row-ok';
    }
    const tot = document.querySelector('[data-cart-total]');
    tot.textContent = slugs.length ? 'HK$' + (total / 100).toLocaleString('en-HK') : '—';
    return probe;
  } catch (e) {
    return 'ERROR: ' + e.message + ' | ' + (e.stack || '').split('\n')[1];
  }
})()
