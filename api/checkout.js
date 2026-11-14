// Vercel serverless: POST /api/checkout  { items: [{ slug, qty }] }
// Resolves each product's active HKD price by its slug metadata (works in
// both the test sandbox and live: the key decides the world), enforces cart
// limits, returns { url } for the hosted Checkout page.
//
// Env: STRIPE_API_KEY (+ optional SITE_URL). Failures are LOUD and named.

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
    headers: { Authorization: `Bearer ${process.env.STRIPE_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
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

/** All Mui WoW products with a slug in metadata (small catalogue → linear scan). */
async function allMuiWowProducts() {
  const all = [];
  let startAfter = null;
  for (;;) {
    const page = await stripe('GET', `/products?limit=100${startAfter ? `&starting_after=${startAfter}` : ''}`);
    all.push(...page.data);
    if (!page.has_more) break;
    startAfter = page.data.at(-1)?.id;
  }
  return all.filter((p) => p.metadata?.site === 'mui-wow' && p.metadata?.slug);
}

async function activeHkdPrice(slug) {
  const product = (await allMuiWowProducts()).find((p) => p.metadata.slug === slug);
  if (!product) return null;
  const prices = await stripe('GET', `/prices?product=${product.id}&active=true&limit=20`);
  return prices.data.find((p) => p.currency === 'hkd') ?? null;
}

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let items;
  try {
    items = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body).items;
  } catch {
    return res.status(400).json({ error: 'bad request body' });
  }
  const parentRef = String((typeof req.body === 'string' ? JSON.parse(req.body) : req.body)?.ref ?? (req.headers['x-booking-ref'] ?? '')).toUpperCase();
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    return res.status(400).json({ error: 'empty or oversized cart' });
  }
  if (!process.env.STRIPE_API_KEY) {
    return res.status(500).json({ error: 'checkout not configured (no STRIPE_API_KEY)' });
  }

  try {
    const catalog = await (await fetch((process.env.SITE_URL ?? 'https://mui-wow-website.vercel.app').replace(/\/$/, '') + '/products.json', { cache: 'no-cache' })).json();
    const line_items = [];
    const freeItems = [];
    let total = 0;
    for (const { slug, qty } of items) {
      if (!/^[a-z0-9-]{1,64}$/.test(String(slug)) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: 'bad item' });
      }
      const price = await activeHkdPrice(String(slug));
      if (!price) {
        // Free products (free entry, HK$0 support) carry no Stripe price.
        // They ride the booking through session metadata instead of a line
        // item, so a mixed cart with a paid item keeps working.
        const p = (catalog.products ?? []).find((c) => c.slug === slug);
        if (!p || p.displayPrice?.amount !== 0) {
          return res.status(404).json({ error: `unknown or unpriced product: ${slug}` });
        }
        freeItems.push({ slug, kind: p.kind ?? 'ticket', name: (p.name?.en ?? slug).replace(/\s*—\s*Mui WoW\s*$/, ''), qty });
        continue;
      }
      line_items.push({ price: price.id, quantity: qty });
      total += price.unit_amount * qty;
    }

    const origin = (process.env.SITE_URL ?? 'https://mui-wow-website.vercel.app').replace(/\/$/, '');
    // Zero-total lane (Stripe Checkout cannot take HK$0 in payment mode):
    // park the cart behind a short-lived capture token and collect the email
    // first — /email-capture confirms it, creates the booking, sends the QR,
    // and sends the visitor to the thank-you page.
    if (total === 0) {
      const crypto = await import('node:crypto');
      const kvBase = process.env.KV_REST_API_URL;
      const kvToken = process.env.KV_REST_API_TOKEN;
      const token = crypto.randomBytes(10).toString('base64url');
      const booked = [];
      for (const { slug, qty } of items) {
        const p = (catalog.products ?? []).find((c) => c.slug === slug);
        booked.push({ slug, kind: p?.kind ?? 'ticket', name: (p?.name?.en ?? slug).replace(/\s*—\s*Mui WoW\s*$/, ''), qty, subtotal: 0, priceId: p?.stripePriceId ?? null });
      }
      const kvRes = await fetch(`${kvBase}/set/${encodeURIComponent(`capture:${token}`)}/${encodeURIComponent(JSON.stringify({ items: booked, amount: 0, createdAt: new Date().toISOString() }))}/EX/1800`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      if (!kvRes.ok) return res.status(502).json({ error: 'ticket lane failed (store)' });
      return res.status(200).json({ url: `${origin}/email-capture?token=${token}` });
    }
    const successUrl = parentRef
      ? `${origin}/addons/${encodeURIComponent(parentRef)}?paid=1`
      : `${origin}/shop-thanks?session_id={CHECKOUT_SESSION_ID}`;
    const session = await stripe('POST', '/checkout/sessions', {
      mode: 'payment',
      success_url: successUrl,
      cancel_url: parentRef ? `${origin}/addons/${encodeURIComponent(parentRef)}` : `${origin}/rentals`,
      line_items,
      metadata: { site: 'mui-wow', ...(parentRef ? { parentRef } : {}), ...(freeItems.length ? { freeItems: JSON.stringify(freeItems) } : {}) },
    });
    return res.status(200).json({ url: session.url, id: session.id });
  } catch (e) {
    console.error('checkout error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}