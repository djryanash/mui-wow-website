const KEY = process.env.STRIPE_API_KEY_TEST;
const API = 'https://api.stripe.com/v1';
async function stripe(m, p, params) {
  const res = await fetch(API + p, {
    method: m,
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const b = await res.json();
  if (!res.ok) throw new Error(res.status + ': ' + (b.error?.message ?? ''));
  return b;
}
const list = await stripe('GET', '/webhook_endpoints');
const existing = list.data.find((w) => w.url === 'https://mui-wow-website.vercel.app/api/stripe-webhook');
const wh = existing
  ? (console.log('NOTE: endpoint already exists; secret not visible again. Recreating fresh one.'),
     await stripe('DELETE', `/webhook_endpoints/${existing.id}`),
     await stripe('POST', '/webhook_endpoints', {
       url: 'https://mui-wow-website.vercel.app/api/stripe-webhook',
       enabled_events: ['checkout.session.completed'],
       description: 'Mui WoW booking engine (sandbox)',
     }))
  : await stripe('POST', '/webhook_endpoints', {
      url: 'https://mui-wow-website.vercel.app/api/stripe-webhook',
      enabled_events: ['checkout.session.completed'],
      description: 'Mui WoW booking engine (sandbox)',
    });
console.log(JSON.stringify({ id: wh.id, secret: wh.secret ?? '(only shown at creation)' }));
