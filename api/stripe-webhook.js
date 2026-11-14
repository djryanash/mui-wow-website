// Vercel serverless: POST /api/stripe-webhook — the booking engine.
//
// 1. Verifies the Stripe signature against STRIPE_WEBHOOK_SECRET (each world
//    — sandbox or live — has its own webhook endpoint and secret; the env
//    that the deployment carries decides).
// 2. For checkout.session.completed: claims a once-only guard
//    (SETNX processed:<sessionId>, 30 days) so redeliveries are no-ops.
// 3. Stores the booking in Upstash: booking:<ref> with state 'reserved'.
// 4. Emails the buyer through Resend with a QR code encoding
//    <origin>/booking/<ref> (best effort — the booking exists regardless).
//
// Env: STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET, KV_REST_API_URL,
//      KV_REST_API_TOKEN, RESEND_API_KEY (optional), SITE_URL (optional).
// Failures are loud and named (RAK lesson).
// IMPORTANT: bodyParser disabled — the signature is verified over Stripe's
// EXACT original bytes; a re-serialized body fails the HMAC.
export const config = { api: { bodyParser: false } };

import QRCode from 'qrcode';
import crypto from 'node:crypto';


// ── Upstash REST (Vercel-integrated names) ──────────────────────

const KV = process.env.KV_REST_API_URL;
const KVT = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const r = await fetch(`${KV}/get/${encodeURIComponent(key)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${KVT}` },
  });
  const b = await r.json();
  if (r.status !== 200) throw new Error(`KV get ${key} → ${r.status}: ${b.error ?? ''}`);
  const raw = b.result ?? null;
  // values are stored JSON-encoded: parse strings so callers see objects
  if (typeof raw === 'string' && raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw ?? null;
}

async function kvSet(key, value) {
  const r = await fetch(`${KV}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KVT}` },
  });
  const b = await r.json();
  if (r.status !== 200 || b.result !== 'OK') throw new Error(`KV set ${key} → ${r.status}: ${b.error ?? b.result}`);
}

async function kvSetNx(key, value, exSeconds) {
  // SET key value NX EX n — once-only claim. result 'OK' = we claimed it.
  const r = await fetch(`${KV}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/NX/EX/${exSeconds}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KVT}` },
  });
  const b = await r.json();
  if (r.status !== 200) throw new Error(`KV setnx ${key} → ${r.status}: ${b.error ?? ''}`);
  return b.result === 'OK';
}

async function kvKeys(prefix) {
  const r = await fetch(`${KV}/keys/${encodeURIComponent(prefix)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${KVT}` },
  });
  const b = await r.json();
  if (r.status !== 200) throw new Error(`KV keys ${prefix} → ${r.status}: ${b.error ?? ''}`);
  return b.result ?? [];
}

export { kvGet, kvSet, kvKeys };

// ── Stripe signature verification (no SDK: two-step HMAC) ───────

function verifyStripeSignature(sigHeader, payload, secret) {
  const parts = sigHeader.split(',').map((s) => s.trim().split('='));
  const timestamp = parts.find((p) => p[0] === 't')?.[1];
  const v1sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!timestamp || v1sigs.length === 0) {
    const err = new Error('signature header missing t/v1 parts');
    err.code = 'bad_sig';
    throw err;
  }
  // Stripe allows ~5 min of clock slack; enforce it to block replay.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > 300) {
    const err = new Error(`signature timestamp too old (${age}s)`);
    err.code = 'bad_sig';
    throw err;
  }
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf-8').digest('hex');
  const ok = v1sigs.some((v) =>
    crypto.timingSafeEqual(Buffer.from(expected, 'utf-8'), Buffer.from(v, 'utf-8')),
  );
  if (!ok) {
    const err = new Error('signature v1 mismatch');
    err.code = 'bad_sig';
    throw err;
  }
}

// ── Stripe helpers (metadata is the join key: price → slug) ─────

const STRIPE = 'https://api.stripe.com/v1';
const bearer = { Authorization: `Bearer ${process.env.STRIPE_API_KEY}` };

async function stripeGet(path) {
  const r = await fetch(`${STRIPE}/${path.replace(/^\//, '')}`, { headers: bearer });
  const b = await r.json();
  if (!r.ok) throw new Error(`Stripe GET ${path} → ${r.status}: ${b.error?.message ?? ''}`);
  return b;
}

const ORIGIN = () => (process.env.SITE_URL ?? 'https://mui-wow-website.vercel.app').replace(/\/$/, '');

/** products.json from the site's own origin (spec §5 runtime contract). */
let productsCache = null;
async function muiWowProducts() {
  if (productsCache) return productsCache;
  const r = await fetch(ORIGIN() + '/products.json', { cache: 'no-cache' });
  productsCache = (await r.json()).products ?? [];
  return productsCache;
}

/** Map of each active price id → its product slug, via Stripe price metadata
 *  (world-correct: the sandbox and live keys each see their own prices). */
async function slugByPriceId() {
  const out = {};
  let startAfter = null;
  for (;;) {
    const page = await stripeGet(`/prices?limit=100&active=true${startAfter ? `&starting_after=${startAfter}` : ''}`);
    for (const p of page.data) if (p.metadata?.site === 'mui-wow' && p.metadata?.slug) out[p.id] = p.metadata.slug;
    if (!page.has_more) break;
    startAfter = page.data.at(-1)?.id;
  }
  return out;
}

/** Items from the session's checked-out line items, each slugged + kinded
 *  (slug via Stripe price metadata; kind via products.json by slug). */
async function sessionItems(sessionId) {
  const si = await stripeGet(`checkout/sessions/${sessionId}?expand[]=line_items`);
  const lines = si?.line_items?.data ?? [];
  if (!lines.length) return [];
  const [slugs, catalog] = await Promise.all([slugByPriceId(), muiWowProducts()]);
  const byPriceId = {};
  for (const li of lines) {
    const slug = slugs[li.price.id] ?? null;
    const p = catalog.find((c) => c.slug === slug);
    byPriceId[li.price.id] = {
      slug,
      kind: p?.kind ?? 'consumable',
      name: (li.description ?? li.price.nickname ?? 'item').replace(/\s*—\s*Mui WoW\s*$/, ''),
      qty: li.quantity,
      subtotal: li.amount_total,
      priceId: li.price.id,
    };
  }
  return Object.values(byPriceId);
}

// ── Email (Resend; best effort, never blocks the 200) ───────────

export async function sendBookingEmail(origin, ref, email, items, amount) {
  if (!email || !process.env.RESEND_API_KEY) return 'skipped (no email/key)';
  // Test-sandbox rule: Resend's unverified domain can only deliver to the
  // account owner's own address. RESEND_REDIRECT_TO (set while testing)
  // redirects EVERY booking email there so the QR is receivable; the buyer's
  // original address stays in the record.
  const to = process.env.RESEND_REDIRECT_TO || email;
  if (!to) return 'skipped (no recipient)';
  const qr = await QRCode.toDataURL(`${origin}/booking/${ref}`, { width: 460, color: { dark: '#0b132b', light: '#ffffff' } });
  const line = items.map((i) => `${i.name} × ${i.qty} — HK$${(i.subtotal / 100).toLocaleString('en-HK')}`).join('<br/>');
  const from = process.env.RESEND_FROM ?? 'Mui WoW <onboarding@resend.dev>'; // sandbox from-address until the domain is verified
  return sendResend(to, `${origin}/booking/${ref}`, `Your Mui WoW booking · ${ref}`, from, ref, line, amount, 'Show this QR code when you arrive — our team scans it and hands over your items:');
}

/** Add-on order confirmation: carries the menu link back to the customer. */
async function sendAddonsEmail(origin, parentRef, email, items, amount) {
  if (!email || !process.env.RESEND_API_KEY) return 'skipped (no email/key)';
  const to = process.env.RESEND_REDIRECT_TO || email;
  if (!to) return 'skipped (no recipient)';
  const line = items.map((i) => `${i.name} × ${i.qty} — HK$${(i.subtotal / 100).toLocaleString('en-HK')}`).join('<br/>');
  const from = process.env.RESEND_FROM ?? 'Mui WoW <onboarding@resend.dev>';
  return sendResend(to, `${origin}/addons/${parentRef}`, `Your second round · Mui WoW · ${parentRef}`, from, parentRef, line, amount, 'Order more anytime — scan or open your add-on menu:');
}

async function sendResend(to, targetUrl, subject, from, ref, line, amount, qrCaption) {
  const qr = await QRCode.toDataURL(targetUrl, { width: 460, color: { dark: '#0b132b', light: '#ffffff' } });
  const out = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;background:#0b132b;color:#f5f2ea;padding:28px;border-radius:16px">
        <h1 style="color:#f0a500;margin-top:0">Mui WoW — your booking 💛</h1>
        <p>Booking reference: <b style="font-size:1.2em">${ref}</b></p>
        ${line ? `<p>${line}</p>` : ''}
        ${amount ? `<p>Paid: <b>HK$${(amount / 100).toLocaleString('en-HK')}</b></p>` : ''}
        <p style="margin:22px 0">${qrCaption}</p>
        <div style="background:#fff;display:inline-block;border-radius:12px;padding:14px">
          <img src="${qr}" width="240" height="240" alt="QR code" />
        </div>
        <p style="color:#38a3a5;font-size:0.9em">Or open: ${targetUrl}</p>
        <p style="color:#8fa3b8;font-size:0.85em">Questions? DM @mui.wow on Instagram.</p>
      </div>`,
    }),
  });
  if (!out.ok) {
    const b = await out.json().catch(() => ({}));
    throw new Error(`Resend send → ${out.status}: ${b.message ?? ''}`);
  }
  return `sent to ${to}`;
}

// ── The handler ─────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
  const payload = raw;
  const sigHeader = req.headers['stripe-signature'];

  let event;
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    verifyStripeSignature(sigHeader, payload, process.env.STRIPE_WEBHOOK_SECRET);
    event = JSON.parse(payload);
  } catch (e) {
    console.error(`webhook delivery rejected: ${e.message}`);
    return res.status(400).json({ error: e.message });
  }

  if (event.type !== 'checkout.session.completed') return res.status(200).json({ received: true, ignored: event.type });

  const session = event.data.object;
  if (session.metadata?.site !== 'mui-wow') return res.status(200).json({ received: true, ignored: 'foreign session' });

  // Once-only guard (spec §12): claim first, then act; redeliveries skip.
  const claimed = await kvSetNx(`processed:${session.id}`, '1', 60 * 60 * 24 * 30);
  if (!claimed) return res.status(200).json({ received: true, duplicate: true });

  try {
    const origin = ORIGIN();
    const parentRef = String(session.metadata?.parentRef ?? '').toUpperCase();
    const ref = session.id.replace(/^cs_(test|live)_/, '').slice(0, 12).toUpperCase();
    const items = await sessionItems(session.id);

    const allDonation = items.length > 0 && items.every((i) => i.kind === 'donation');

    if (allDonation) {
      // Support tier: a thank-you record only; no pickup, no QR, no staff flow.
      await kvSet(`booking:${ref}`, {
        ref,
        type: 'donation',
        email: session.customer_details?.email ?? '',
        state: 'reserved',
        amount: session.amount_total,
        sessionId: session.id,
        items,
        createdAt: new Date().toISOString(),
      });
      console.log(`donation-only session ${ref} recorded (no QR flow)`);
      return res.status(200).json({ received: true, ref, donation: true });
    }

    if (parentRef && parentRef !== ref) {
      // Add-on re-order: attach to the parent booking's chain.
      const raw = await kvGet(`booking:${parentRef}`);
      if (!raw) throw new Error(`add-on order for unknown booking ${parentRef}`);
      const booking = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const order = {
        id: ref, items, amount: session.amount_total, state: 'reserved', createdAt: new Date().toISOString(),
      };
      booking.orders = [...(booking.orders ?? []), order];
      await kvSet(`booking:${parentRef}`, booking);
      await kvSet(`session:${session.id}`, { ref: parentRef });
      const emailResult = await sendAddonsEmail(origin, parentRef, booking.email, items, session.amount_total)
        .then((r) => r)
        .catch((e) => `failed (order still recorded): ${e.message}`);
      console.log(`add-on order ${ref} → ${parentRef}; email: ${emailResult}`);
      return res.status(200).json({ received: true, ref, chain: parentRef, email: emailResult });
    }

    // Root order (hamper booking, or a standalone add-on order from the
    // post-payment upsell): a first-class booking record.
    await kvSet(`booking:${ref}`, {
      ref,
      email: session.customer_details?.email ?? '',
      state: 'reserved',
      amount: session.amount_total,
      sessionId: session.id,
      items,
      orders: [],
      createdAt: new Date().toISOString(),
    });
    await kvSet(`session:${session.id}`, { ref });

    const emailResult = await sendBookingEmail(origin, ref, session.customer_details?.email, items, session.amount_total)
      .then((r) => r)
      .catch((e) => `failed (booking still recorded): ${e.message}`);
    console.log(`booking ${ref} recorded; email: ${emailResult}`);

    return res.status(200).json({ received: true, ref, email: emailResult });
  } catch (e) {
    // Roll the guard back so the next delivery retries (spec §12 mechanics).
    await fetch(`${KV}/del/${encodeURIComponent(`processed:${session.id}`)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KVT}` },
    }).catch(() => {});
    console.error('webhook processing failed, guard rolled back:', e.message);
    return res.status(500).json({ error: e.message });
  }
}