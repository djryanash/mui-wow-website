(function(){
  // install an error trap, then trigger the page's own click handler
  let lastErr = null;
  window.addEventListener('error', (e) => { lastErr = e.message + ' @ ' + (e.filename ?? '') + ':' + e.lineno; });
  // find the "Add to cart" button and the current badge/total
  const b = document.querySelector('[data-add-to-cart]');
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const after = localStorage.getItem('muiwow-cart');
  const badge = document.querySelector('[data-cart-badge]').textContent;
  const total = document.querySelector('[data-cart-total]').textContent;
  const open = document.getElementById('cart-drawer').classList.contains('open');
  // then: does a manual localStorage change + our manual render show? (isolate: is the module's render reachable?)
  return JSON.stringify({ badge, total, open, lastErr, after });
})()
