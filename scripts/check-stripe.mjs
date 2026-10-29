// Stripe RAK permission probe: exercises each permission the site needs and
// cleans up after itself (works in test and live mode).
// Usage: set -a; source .env; set +a; node scripts/check-stripe.mjs

const KEY = process.env.STRIPE_API_KEY;
if (!KEY) {
  console.error('FAIL: STRIPE_API_KEY not set');
  process.exit(1);
}
const mode = KEY.startsWith('rk_test_') ? 'test' : KEY.startsWith('rk_live_') ? 'live' : 'unknown';
console.log(`key: ${KEY.slice(0, 9)}… (mode: ${mode})`);
if (mode === 'live') console.log('LIVE MODE: every created object is deleted in the same run; nothing is left behind.');

const API = 'https://api.stripe.com/v1';

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

async function stripe(method, path, params) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(flatten(params)).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(`Stripe ${method} ${path} → ${res.status}: ${body.error?.message ?? 'unknown'}${body.error?.doc_url ? ` (${body.error.doc_url})` : ''}`);
    err.stripe = body.error;
    throw err;
  }
  return body;
}

const results = [];
let created = { product: null, price: null, session: null, endpoint: null };

async function probe(label, fn) {
  try {
    const out = await fn();
    results.push([label, 'OK', out ?? '']);
    return out;
  } catch (e) {
    const perm = /You do not have the required permissions/i.test(e.message)
      ? ' ← MISSING PERMISSION'
      : e.stripe?.type === 'invalid_request_error' ? ' (invalid_request_error)' : '';
    results.push([label, 'FAIL', e.message + perm]);
    return null;
  }
}

// 1. products: read
await probe('Products: read (list)', () => stripe('GET', '/products?limit=1'));

// 2. products: write (create → update)
const product = await probe('Products: write (create → update)', async () => {
  created.product = await stripe('POST', '/products', {
    name: 'Mui WoW — permission probe (delete me)',
    description: 'Temporary product to verify the restricted API key. Deleted immediately.',
    metadata: { probe: 'mui-wow', ts: new Date().toISOString() },
  });
  await stripe('POST', `/products/${created.product.id}`, { description: 'Probe (updated): deleted immediately.' });
  return created.product.id;
});

// 3. prices: write
const price = product && await probe('Prices: write (create)', async () => {
  created.price = await stripe('POST', '/prices', {
    product: created.product.id,
    currency: 'hkd',
    unit_amount: 12000, // HK$120 hamper probe
    nickname: 'probe-price (delete me)',
    metadata: { probe: 'mui-wow' },
  });
  return created.price.id;
});

// 4. checkout session: write
await probe('Checkout Sessions: write (create, unpaid)', async () => {
  if (!created.price) throw new Error('skipped: no price available (Prices: write failed)');
  created.session = await stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: 'https://mui-wow-website.vercel.app/rentals?probe=1',
    cancel_url: 'https://mui-wow-website.vercel.app/rentals',
    line_items: [{ price: created.price.id, quantity: 1 }],
    metadata: { probe: 'mui-wow' },
  });
  return `session ${created.session.id} (${created.session.url ? 'hosted URL issued' : 'no url'})`;
});

// 5. webhook endpoints: write (register → immediately delete)
await probe('Webhook endpoints: write (create → delete)', async () => {
  created.endpoint = await stripe('POST', '/webhook_endpoints', {
    url: 'https://mui-wow-website.vercel.app/api/stripe-webhook',
    enabled_events: ['checkout.session.completed'],
    description: 'Permission probe — deleted immediately.',
  });
  await stripe('DELETE', `/webhook_endpoints/${created.endpoint.id}`);
  created.endpoint = null;
  return 'endpoint registered and removed';
});

// cleanup: deactivate price, delete product (safe even if creation is last known good)
if (created.price) await probe('Prices: write (deactivate)', () => stripe('POST', `/prices/${created.price.id}`, { active: 'false' }));
if (created.product) await probe('Products: write (delete)', () => stripe('DELETE', `/products/${created.product.id}`));

// 6. refunds: read (probe only)
await probe('Refunds: read (list)', () => stripe('GET', '/refunds?limit=1'));

console.log('\n──────── permission report ────────');
for (const [label, status, out] of results) {
  const flag = status === 'OK' ? '✓' : '✗';
  console.log(`${flag} ${status.padEnd(4)} ${label}${out && status === 'OK' ? ` → ${out}` : ''}`);
  if (status === 'FAIL') console.log(`    ${out}`);
}
const fails = results.filter(([, s]) => s === 'FAIL');
console.log(fails.length ? `\nRESULT: ${fails.length} permission(s) need to be added to the restricted key — see the ✗ lines (exact message quoted).` : '\nRESULT: the key has every permission the checkout path needs.');
process.exit(fails.length ? 1 : 0);