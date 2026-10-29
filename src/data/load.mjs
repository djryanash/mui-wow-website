// Build-time loader: parse + validate every YAML, apply selection rules.
// The build fails loudly on anything broken (spec §9) — a missing or
// malformed file stops the build, it never renders a blank page.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { eventSchema, siteSchema, productSchema } from './events.lib.mjs';

const ROOT = process.cwd();

function readYaml(path) {
  let parsed;
  try {
    parsed = yaml.load(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`YAML parse error in ${path}: ${e.message}`);
  }
  return parsed;
}

function assertSchema(schema, data, path) {
  const res = schema.safeParse(data);
  if (!res.success) {
    const problems = res.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Schema validation FAILED for ${path}:\n${problems}`);
  }
  return res.data;
}

/** All published+unlisted filtering happens via pick* helpers; this is raw. */
export function loadEvents(dir = 'src/events') {
  const full = join(ROOT, dir);
  return readdirSync(full)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => assertSchema(eventSchema, readYaml(join(full, f)), `src/events/${f}`))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function loadSite(path = 'src/data/site.yaml') {
  return assertSchema(siteSchema, readYaml(join(ROOT, path)), path);
}

/** All published products (catalog order = file order, then sorted by name). */
export function loadProducts(dir = 'src/products') {
  const full = join(ROOT, dir);
  return readdirSync(full)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_')) // _-prefixed = docs only
    .map((f) => assertSchema(productSchema, readYaml(join(full, f)), `src/products/${f}`))
    .filter((p) => p.published)
    .sort((a, b) => t(a.name, 'en').localeCompare(t(b.name, 'en')));
}

export { isPast, pickFeatured, pickRecentsPast, pickUpcoming, t, normalizeLights } from './events.lib.mjs';