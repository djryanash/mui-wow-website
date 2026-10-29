(async function(){
  const form = document.getElementById('gate-form');
  form.querySelector('input').value = GATE_VALUE;
  const r = await fetch('/api/staff?gate=' + encodeURIComponent(GATE_VALUE)).then(x => x.json());
  const view = document.getElementById('staff-view');
  // the page's own submit path:
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(res => setTimeout(res, 1200));
  return JSON.stringify({ apiOK: !!r.gate, viewVisible: !view.hidden, text: document.getElementById('bookings')?.textContent.slice(0, 120) });
})()
