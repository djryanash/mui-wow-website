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

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

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
  return b.result ?? null;
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

/** Items from the session's checked-out line items, named from the product YAML convention. */
async function sessionItems(sessionId) {
  const si = await stripeGet(`checkout/sessions/${sessionId}?expand[]=line_items`);
  const lines = si?.line_items?.data ?? [];
  if (!lines.length) return [];
  const byPriceId = {};
  for (const li of lines) byPriceId[li.price.id] = { name: li.description ?? li.price.nickname ?? 'item', qty: li.quantity, subtotal: li.amount_total, priceId: li.price.id };
  return Object.values(byPriceId);
}

// ── Email (Resend; best effort, never blocks the 200) ───────────

async function sendBookingEmail(origin, ref, email, items, amount) {
  if (!email || !process.env.RESEND_API_KEY) return 'skipped (no email/key)';
  // Test-sandbox rule: Resend's unverified domain can only deliver to the
  // account owner's own address. RESEND_REDIRECT_TO (set while testing)
  // redirects EVERY booking email there so the QR is receivable; the buyer's
  // original address stays in the record and in the template's own line.
  const to = process.env.RESEND_REDIRECT_TO || email;
  if (!to) return 'skipped (no recipient)';
  const qr = await QRCode.toDataURL(`${origin}/booking/${ref}`, {
    width: 460,
    color: { dark: '#0b132b', light: '#ffffff' },
  });
  const line = items
    .map((i) => `${i.name} × ${i.qty} — HK$${(i.subtotal / 100).toLocaleString('en-HK')}`)
    .join('<br/>');
  const from = process.env.RESEND_FROM ?? 'Mui WoW <onboarding@resend.dev>'; // sandbox from-address until the domain is verified
  const out = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `Your Mui WoW booking · ${ref}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;background:#0b132b;color:#f5f2ea;padding:28px;border-radius:16px">
        <h1 style="color:#f0a500;margin-top:0">Mui WoW — your booking 💛</h1>
        <p>Booking reference: <b style="font-size:1.2em">${ref}</b></p>
        ${line ? `<p>${line}</p>` : ''}
        ${amount ? `<p>Paid: <b>HK$${(amount / 100).toLocaleString('en-HK')}</b></p>` : ''}
        <p style="margin:22px 0">Show this QR code when you arrive — our team scans it and hands over your items:</p>
        <div style="background:#fff;display:inline-block;border-radius:12px;padding:14px">
          <img src="${qr}" width="240" height="240" alt="booking QR code" />
        </div>
        <p style="color:#38a3a5;font-size:0.9em">Or open this link: ${origin}/booking/${ref}</p>
        <p style="color:#8fa3b8;font-size:0.85em">Questions? DM @mui.wow on Instagram.</p>
      </div>`,
    }),
  });
  if (!out.ok) {
    const b = await out.json().catch(() => ({}));
    throw new Error(`Resend send → ${out.status}: ${b.message ?? ''}`);
  }
  return 'sent';
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
    const origin = (process.env.SITE_URL ?? 'https://mui-wow-website.vercel.app').replace(/\/$/, '');
    const ref = session.id.replace(/^cs_(test|live)_/, '').slice(0, 12).toUpperCase();
    const items = await sessionItems(session.id);

    await kvSet(`booking:${ref}`, {
      ref,
      email: session.customer_details?.email ?? '',
      state: 'reserved',
      amount: session.amount_total,
      sessionId: session.id,
      items,
      createdAt: new Date().toISOString(),
    });

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