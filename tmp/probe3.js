(function(){
  const b = document.querySelector('[data-add-to-cart]');
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const badge = document.querySelector('[data-cart-badge]').textContent;
  const total = document.querySelector('[data-cart-total]').textContent;
  const open = document.getElementById('cart-drawer').classList.contains('open');
  const row = document.querySelector('.cart-items .cart-row')?.textContent ?? '';
  return JSON.stringify({ badge, total, open, row });
})()
