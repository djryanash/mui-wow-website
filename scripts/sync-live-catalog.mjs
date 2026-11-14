// Sync the site's YAML catalog to the LIVE Stripe account (idempotent).
//
// For every orderable site product with a real price (support-0 and
// tiki-free-entry are free, never priced), this ensures:
//   1. a product exists on Stripe with metadata { site: 'mui-wow', slug },
//   2. it has an active HKD price at the YAML displayPrice amount,
//   3. the YAML's stripePriceId record points at the LIVE price id.
//
// Safe to re-run: products and prices are matched by slug + currency.
// Env: STRIPE_API_KEY must be a LIVE key (rk_live_… / sk_live_…).
// Usage: node scripts/sync-live-catalog.mjs [--dry]

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const dry = process.argv.includes('--dry');
const KEY = process.env.STRIPE_API_KEY;
if (!KEY || !/^(rk|sk)_(live|restricted)_/.test(KEY)) {
  console.error('FAIL: STRIPE_API_KEY must look like a live key (rk_live_/sk_live_)');
  process.exit(1);
}
const DIR = path.resolve(process.cwd(), 'src/products');
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

async function stripe(method, path, params) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(flatten(params)).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path} → ${res.status}: ${body.error?.message ?? 'unknown'}`);
  return body;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.yaml') && !f.startsWith('_'));
const results = [];

for (const file of files) {
  const doc = yaml.load(readFileSync(path.join(DIR, file), 'utf-8'));
  const slug = doc.slug;
  const amount = doc.displayPrice?.amount ?? 0;
  const sellable = doc.published && doc.orderable && doc.kind !== 'ticket' && amount > 0;
  if (!slug) { results.push([file, 'SKIP (no slug)']); continue; }
  if (!sellable) { results.push([file, `SKIP (free ${doc.kind})`]); continue; }

  const prods = await stripe('GET', `/products?limit=100&active=true`);
  let product = prods.data.find((p) => p.metadata?.site === 'mui-wow' && p.metadata?.slug === slug);
  let action = 'product ok';
  if (!product) {
    if (dry) { results.push([slug, 'WOULD create product + price']); continue; }
    product = await stripe('POST', '/products', {
      name: doc.name?.en ?? slug,
      description: doc.subtitle?.en ?? undefined,
      metadata: { site: 'mui-wow', slug, kind: doc.kind ?? 'consumable' },
    });
    action = 'product created';
  }

  let prices = await stripe('GET', `/prices?product=${product.id}&active=true&limit=50`);
  let price = prices.data.find((p) => p.currency === 'hkd' && p.unit_amount === amount);
  if (!price) {
    if (dry) { results.push([slug, `${action}; WOULD add HKD price ${amount}`]); continue; }
    price = await stripe('POST', '/prices', {
      product: product.id,
      currency: 'hkd',
      unit_amount: amount,
    });
    action += ' + price created';
  } else if (action === 'product ok') action = 'price ok';

  // stamp the live price id into the YAML (replace any existing record)
  const raw = readFileSync(path.join(DIR, file), 'utf-8');
  const updated = /stripePriceId:/
    ? raw.replace(/stripePriceId:\s*'[^']*'.*(#.*|)$/m, `stripePriceId: '${price.id}' # live`)
    : raw.replace(/(kind:.*)/, `$1\nstripePriceId: '${price.id}' # live`);
  if (updated !== raw && !dry) writeFileSync(path.join(DIR, file), updated);
  results.push([slug, `${action} (${price.id})`]);
}

for (const [slug, note] of results) console.log(slug.padEnd(34), note);
console.log(results.filter(([, n]) => !n.includes('SKIP')).length, 'live products priced and recorded');
