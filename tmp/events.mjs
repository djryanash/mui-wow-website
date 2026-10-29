const KEY = process.env.STRIPE_API_KEY_TEST;
const r = await fetch('https://api.stripe.com/v1/events?limit=10', { headers: { Authorization: 'Bearer ' + KEY } });
const b = await r.json();
for (const e of (b.data ?? [])) console.log(e.type, '|', e.data?.object?.id ?? '');
