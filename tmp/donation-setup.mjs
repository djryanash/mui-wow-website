const KEY = process.env.STRIPE_API_KEY_TEST;
const API = 'https://api.stripe.com/v1';
function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) for (const i in v) out.push(...(typeof v[i] === 'object' ? flatten(v[i], `${key}[${i}]`) : [[`${key}[${i}]`, String(v[i])]]));
    else if (v != null && typeof v === 'object') out.push(...flatten(v, key));
    else out.push([key, String(v)]);
  }
  return out;
}
async function stripe(m, p, params) {
  const res = await fetch(API + p, { method: m, headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params ? new URLSearchParams(flatten(params)).toString() : undefined });
  const b = await res.json(); if (!res.ok) throw new Error(res.status + ': ' + (b.error?.message ?? '')); return b;
}
(async () => {
  const l = await stripe('GET', '/products?limit=50');
  let p = l.data.find(x => x.metadata?.slug === 'support-muiwow');
  if (!p) p = await stripe('POST', '/products', { name: 'Support Mui WoW', description: 'Support the community events in Mui Wo — pay what you want.', metadata: { slug: 'support-muiwow', site: 'mui-wow' } });
  const prices = await stripe('GET', '/prices?product=' + p.id + '&active=true&limit=20');
  const hk = prices.data.find(x => x.currency === 'hkd');
  if (hk) { console.log(JSON.stringify({ productId: p.id, priceId: hk.id })); return; }
  const price = await stripe('POST', '/prices', {
    product: p.id, currency: 'hkd',
    custom_unit_amount: { enabled: true, minimum: 2000, maximum: 200000 },
    nickname: 'Support Mui WoW — pay what you want',
    metadata: { slug: 'support-muiwow', site: 'mui-wow' },
  });
  console.log(JSON.stringify({ productId: p.id, priceId: price.id }));
})();
