// CSV → product YAMLs → Stripe prices, in one pass (idempotent per slug).
//
// Minimal CSV columns:
//   slug,name_en,price        (required)
//   kind,isAddon,name_es,name_zh,subtitle_en,subtitle_es,subtitle_zh,
//   details_en,image  (optional; image = path under /images/products/<slug>/)
//
// price is in HKD DOLLARS (20 = HK$20; decimals allowed, e.g. 19.50).
// Usage: node scripts/import-csv.mjs <file.csv> [--live|--test]  (default: test)
//
// Creates each product on Stripe with slug metadata (so the webhook + CI
// cross-check keep working), writes the price id into the YAML, and skips
// slugs that already exist on Stripe or as YAML files.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const live = args.includes('--live');
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/import-csv.mjs <file.csv> [--live|--test]');
  process.exit(1);
}

const KEY = live ? process.env.STRIPE_API_KEY : process.env.STRIPE_API_KEY_TEST;
const mode = live ? 'live' : 'test';
if (!KEY) { console.error(`FAIL: no ${live ? 'live' : 'test'} Stripe key in environment`); process.exit(1); }

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
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params ? new URLSearchParams(flatten(params)).toString() : undefined });
  const b = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path} → ${res.status}: ${b.error?.message ?? ''}`);
  return b;
}

const rows = parse(readFileSync(file, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
const errors = [];

for (const row of rows) {
  const slug = (row.slug ?? '').trim();
  const nameEn = (row.name_en ?? '').trim();
  const priceRaw = (row.price ?? '').trim();
  if (!slug || !nameEn || !priceRaw) { errors.push(`skip ${slug || '(no slug)'}: missing slug, name_en or price`); continue; }
  if (!/^[a-z0-9]+(?:-(?!$)[a-z0-9]+)*$/.test(slug)) { errors.push(`skip ${slug}: bad slug (lowercase letters/digits/hyphens)`); continue; }

  const cents = Math.round(Number(priceRaw) * 100);
  if (!Number.isFinite(cents) || cents <= 0) { errors.push(`skip ${slug}: bad price "${priceRaw}"`); continue; }

  const kind = (row.kind ?? 'consumable').trim();
  const isAddon = String(row.isAddon ?? '').toLowerCase() === 'true';
  const yml = `src/products/${slug}.yaml`;

  let stripePriceId;
  try {
    // idempotent per slug: reuse the product if it exists in this world
    const list = await stripe('GET', '/products?limit=50');
    let product = list.data.find((p) => p.metadata?.site === 'mui-wow' && p.metadata?.slug === slug);
    if (!product) {
      product = await stripe('POST', '/products', {
        name: `${nameEn} — Mui WoW`,
        ...(row.details_en ? { description: row.details_en } : {}),
        metadata: { slug, site: 'mui-wow' },
      });
    }
    // reuse the active HKD price if one exists at this amount; else create
    const prices = await stripe('GET', `/prices?product=${product.id}&active=true&limit=20`);
    let price = prices.data.find((p) => p.currency === 'hkd');
    if (price && Number(price.unit_amount) !== cents) throw new Error(`live HKD price at ${price.unit_amount} ≠ ${cents} — fix the CSV, prices are immutable`);
    if (!price) price = await stripe('POST', '/prices', { product: product.id, currency: 'hkd', unit_amount: String(cents), nickname: `${nameEn} — HK$${Number(priceRaw)}`, metadata: { slug, site: 'mui-wow' } });
    stripePriceId = price.id;
  } catch (e) {
    errors.push(`skip ${slug}: ${e.message}`);
    continue;
  }

  const langObj = (en, es, zh) => {
    if (!es && !zh) return en ? `{ en: ${en} }` : undefined;
    return `{${[en && ` en: ${en}`, es && ` es: ${es}`, zh && ` zh: ${zh}`].filter(Boolean).join(',')}\n  }`;
  };
  const q = (s) => (s != null ? `'${String(s).replace(/'/g, "''")}'` : undefined);
  const image = (row.image ?? '').trim();

  const body = [
    `slug: ${q(slug)}`,
    `published: true`,
    `kind: ${q(kind)}`,
    isAddon ? `isAddon: true` : undefined,
    `orderable: true`,
    `name: ${langObj(q(nameEn), row.name_es ? q(row.name_es) : undefined, row.name_zh ? q(row.name_zh) : undefined)}`,
    row.subtitle_en ? `subtitle: ${langObj(q(row.subtitle_en), row.subtitle_es ? q(row.subtitle_es) : undefined, row.subtitle_zh ? q(row.subtitle_zh) : undefined)}` : undefined,
    `displayPrice:\n  amount: ${cents}\n  currency: 'HKD'\n  formatted: 'HK$${Number(priceRaw)}'`,
    `stripePriceId: ${q(stripePriceId)} # ${mode}`,
    `inventory:\n  perEvent: true\n  stock: 10`,
    image ? `images:\n  - ${q(image)}` : undefined,
    row.details_en ? `details:\n  en: >-\n    ${row.details_en.replace(/\n/g, ' ')}` : undefined,
  ].filter(Boolean).join('\n') + '\n';

  if (existsSync(yml)) { errors.push(`skip ${slug}: yaml already exists (not overwritten)`); continue; }
  writeFileSync(yml, body);
  console.log(`✓ ${slug} → ${yml} (${mode} price ${stripePriceId})`);
}

if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
console.log(`\nimport complete (${mode} mode) — run 'npm run prebuild' to refresh products.json`);
