// Vercel serverless: POST /api/booking-confirm { token, email }
// Completes the zero-total lane: reads the parked cart behind the capture
// token, creates the booking, sends the QR email, burns the token
// (SETNX-style delete), and answers with the booking ref.
//
// Env: KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY (optional while
// the domain is unverified), SITE_URL (optional).

import { kvGet, kvSet, sendBookingEmail } from './stripe-webhook.js';
import crypto from 'node:crypto';

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const token = String(body.token ?? '');
  const email = String(body.email ?? '').trim();
  if (!token || token.length < 10 || token.length > 64) return res.status(400).json({ error: 'bad token' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad email' });

  let capture;
  try {
    capture = await kvGet(`capture:${token}`);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
  if (!capture) return res.status(404).json({ error: 'capture expired — start again from the cart' });
  const parked = typeof capture === 'string' ? JSON.parse(capture) : capture;
  if (parked.used) return res.status(409).json({ error: 'capture already used' });

  const ref = ('T' + crypto.randomBytes(5).toString('hex')).toUpperCase().slice(0, 11);
  const booking = {
    ref,
    type: 'ticket',
    email,
    state: 'reserved',
    amount: 0,
    sessionId: null,
    items: parked.items ?? [],
    orders: [],
    createdAt: new Date().toISOString(),
    history: [{ action: 'email-captured', at: new Date().toISOString() }],
  };
  try {
    await kvSet(`booking:${ref}`, booking);
    // Burn the token (TTL catches strays): reused tokens are rejected via `used`.
    await kvSet(`capture:${token}`, { used: true });
  } catch (e) {
    return res.status(502).json({ error: 'booking failed (store)' });
  }

  const origin = (process.env.SITE_URL ?? 'https://www.muiwow.com').replace(/\/$/, '');
  const emailResult = await sendBookingEmail(origin, ref, email, booking.items, 0)
    .then((r) => r)
    .catch((e) => `failed: ${e.message}`);

  console.log(`zero-lane booking ${ref} confirmed for ${email}; email: ${emailResult}`);
  return json(200, { ok: true, ref });
}