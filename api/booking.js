// Vercel serverless: GET /api/booking?ref=<REF> — public booking status.
// Read-only for everyone; state changes live in staff-only routes.
// Staff detection: a valid staff cookie upgrades the response (staff: true).

import { kvGet, kvSet, sendBookingEmail } from './stripe-webhook.js';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

function staffCookieValue() {
  const secret = process.env.STAFF_GATE;
  if (!secret || !process.env.STRIPE_WEBHOOK_SECRET) return null; // no gate, no staff
  // Cookie value binds the gate AND the webhook secret; rotating either
  // invalidates the cookie fleet.
  return crypto.createHash('sha256').update(`${secret}.${process.env.STRIPE_WEBHOOK_SECRET}`).digest('hex').slice(0, 32);
}

function hasStaffCookie(req) {
  const want = staffCookieValue();
  if (!want) return false;
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')),
  );
  return cookies['muiwow_staff'] === want;
}

export default async function handler(req, res) {
  // POST /api/booking { ref, email } — email capture for bookings made
  // without checkout (free-ticket lane): attaches the address and sends
  // the same QR email the webhook would have sent at payment.
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const ref = String(body.ref ?? '').toUpperCase();
    const email = String(body.email ?? '').trim();
    if (!/^[A-Z0-9]{6,16}$/.test(ref)) return res.status(400).json({ error: 'bad ref' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad email' });

    const raw = await kvGet(`booking:${ref}`);
    if (!raw) return res.status(404).json({ error: 'unknown booking' });
    const booking = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!booking.email) booking.email = email;
    booking.history = [...(booking.history ?? []), { action: 'email-captured', at: new Date().toISOString() }];
    await kvSet(`booking:${ref}`, booking);

    const origin = (process.env.SITE_URL ?? 'https://mui-wow-website.vercel.app').replace(/\/$/, '');
    const emailResult = await sendBookingEmail(origin, booking.ref, email, booking.items ?? [], booking.amount)
      .then((r) => r)
      .catch((e) => `failed: ${e.message}`);
    console.log(`booking ${ref} email captured; send: ${emailResult}`);
    return res.status(200).json({ ok: true, emailSent: !emailResult.includes('failed') });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  let ref;
  if (req.query?.session_id) {
    // checkout return flow: resolve the session id → booking ref
    // (records come back as JSON strings — parse before reading .ref)
    const refFrom = (raw) => { try { return (typeof raw === 'string' ? JSON.parse(raw) : raw)?.ref; } catch { return null; } };
    ref = String(refFrom(await kvGet(`session:${String(req.query.session_id)}`)) ?? '').toUpperCase();
    if (!ref) return res.status(404).json({ error: 'unknown session' });
  } else {
    ref = String(req.query?.ref ?? '').toUpperCase();
    if (!/^[A-Z0-9]{6,16}$/.test(ref)) return res.status(400).json({ error: 'bad ref' });
  }

  let booking;
  try {
    booking = await kvGet(`booking:${ref}`);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
  if (!booking) {
    return res.status(404).json({ error: 'unknown booking' });
  }
  if (typeof booking === 'string') booking = JSON.parse(booking);

  let qrDataUrl = null;
  try {
    if (booking.state !== 'returned') {
      const origin = (process.env.SITE_URL ?? 'https://mui-wow-website.vercel.app').replace(/\/$/, '');
      qrDataUrl = await QRCode.toDataURL(`${origin}/booking/${ref}`, { width: 460, color: { dark: '#0b132b', light: '#ffffff' } });
    }
  } catch {
    // QR render is best effort — the status facts still return.
  }

  return res.status(200).json({
    ref: booking.ref,
    items: booking.items ?? [],
    amount: booking.amount,
    state: booking.state,
    createdAt: booking.createdAt,
    qr: qrDataUrl,
    staff: hasStaffCookie(req), // customers get read-only facts, staff get actions
    hasEmail: !!booking.email, // drives the email-capture field on free lane only
  });
}