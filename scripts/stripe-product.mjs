// Create/update a product + price on Stripe from explicit args (idempotent:
// an existing product with the same slug metadata is reused, and so is an
// existing active HKD price on it). LIVE-MODE SAFE: only creates/updates
// objects intended for real use; never probes or deletes.
// Usage: node scripts/stripe-product.mjs <slug> <name> <unitAmountCents> [description]
// Reads STRIPE_API_KEY from environment.

const KEY = process.env.STRIPE_API_KEY;
if (!KEY || !KEY.startsWith('rk_')) {
  console.error('FAIL: STRIPE_API_KEY not set (or not a restricted key)');
  process.exit(1);
}
const [slug, name, amount, description] = process.argv.slice(2);
if (!slug || !name || !amount) {
  console.error('usage: node scripts/stripe-product.mjs <slug> <name> <unitAmountCents> [description]');
  process.exit(1);
}

// Stripe's form encoding: nested objects → metadata[k]=v, arrays → arr[0]=…
function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      for (const i in v) {
        const item = v[i];
        out.push(...(typeof item === 'object' ? flatten(item, `${key}[${i}]`) : [[`${key}[${i}]`, String(item)]]));
      }
    } else if (v != null && typeof v === 'object') {
      out.push(...flatten(v, key));
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

const API = 'https://api.stripe.com/v1';
async function stripe(method, path, params) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(flatten(params)).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(`Stripe ${method} ${path} → ${res.status}: ${body.error?.message ?? 'unknown'}`);
    err.stripe = body.error;
    throw err;
  }
  return body;
}

(async () => {
  const existing = await stripe('GET', '/products?limit=50');
  const dup = existing.data.find((p) => p.metadata?.slug === slug && p.metadata?.site === 'mui-wow');
  const product = dup ?? (await stripe('POST', '/products', {
    name: `${name} — Mui WoW`,
    ...(description ? { description } : {}),
    metadata: { slug, site: 'mui-wow' },
  }));

  const prices = await stripe('GET', `/prices?product=${product.id}&active=true`);
  let price = prices.data.find((p) => p.currency === 'hkd');
  if (price && Number(price.unit_amount) !== Number(amount)) {
    throw new Error(`live HKD price exists at ${price.unit_amount} but YAML says ${amount} — update one of them`);
  }
  if (!price) {
    price = await stripe('POST', '/prices', {
      product: product.id,
      currency: 'hkd',
      unit_amount: String(amount),
      nickname: `${name} — HK$${(Number(amount) / 100).toFixed(0)}`,
      metadata: { slug, site: 'mui-wow' },
    });
  }

  console.log(JSON.stringify({ productId: product.id, priceId: price.id, unit_amount: price.unit_amount, currency: price.currency }, null, 2));
})().catch((e) => {
  console.error('FAIL ' + e.message);
  process.exit(1);
});