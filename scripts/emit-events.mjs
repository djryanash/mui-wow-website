// prebuild: emit public/events.json + public/products.json — the committed
// artifacts that are both the build-time input and the runtime data surface
// (spec §5). Commit them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { eventSchema } from '../src/data/events.lib.mjs';
import { loadEvents, loadSite, loadProducts } from '../src/data/load.mjs';

const events = loadEvents().map((e) => ({
  slug: e.slug,
  title: e.title,
  subtitle: e.subtitle ?? null,
  start: e.start,
  end: e.end ?? null,
  location: e.location,
  published: e.published,
  unlisted: e.unlisted,
  heroEffect: e.heroEffect,
  poster: e.poster ?? null,
}));

const products = loadProducts().map((p) => ({
  slug: p.slug,
  kind: p.kind,
  name: p.name,
  subtitle: p.subtitle ?? null,
  displayPrice: p.displayPrice,
  inventory: p.inventory.perEvent ? { perEvent: true, stock: p.inventory.stock ?? null } : { perEvent: false },
  images: p.images,
}));

const site = loadSite();

const out = {
  generatedAt: new Date().toISOString(),
  site: { name: site.name, legalName: site.legalName, instagram: site.instagram },
  events,
};

mkdirSync('public', { recursive: true });
writeFileSync('public/events.json', JSON.stringify(out, null, 2) + '\n');
writeFileSync(
  'public/products.json',
  JSON.stringify({ generatedAt: out.generatedAt, products }, null, 2) + '\n',
);
console.log(`emit: ${events.length} event(s) → public/events.json; ${products.length} product(s) → public/products.json`);