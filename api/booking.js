// Vercel serverless: GET /api/booking?ref=<REF> — public booking status.
// Read-only for everyone; state changes live in staff-only routes.
// Staff detection: a valid staff cookie upgrades the response (staff: true).

import { kvGet } from './stripe-webhook.js';
import crypto from 'node:crypto';

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const ref = String(req.query?.ref ?? '').toUpperCase();
  if (!/^[A-Z0-9]{6,16}$/.test(ref)) {
    return res.status(400).json({ error: 'bad ref' });
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

  return res.status(200).json({
    ref: booking.ref,
    items: booking.items ?? [],
    amount: booking.amount,
    state: booking.state,
    createdAt: booking.createdAt,
    staff: hasStaffCookie(req), // customers get read-only facts, staff get actions
  });
}