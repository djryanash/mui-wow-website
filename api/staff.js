// Vercel serverless: /api/staff — gate, dashboard data, and state actions.
//
//  GET  /api/staff?gate=<STAFF_GATE>  → validates the gate, sets the staff
//       cookie, and answers with the dashboard payload (active bookings).
//  GET  /api/staff                    → 401 unless valid staff cookie.
//  POST /api/staff  { ref, action: 'collect' | 'return' | 'unreserve' }
//                                     → staff-cookie required; flips state.
//
// The gate is the ONE secret (env STAFF_GATE); no accounts, no sessions to
// build, rotation = changing one env var. Every mutation is audited into
// the booking record (state history with timestamps).

import { kvGet, kvSet, kvKeys } from './stripe-webhook.js';
import crypto from 'node:crypto';

const COOKIE = 'muiwow_staff';

function expectedCookie() {
  const secret = process.env.STAFF_GATE;
  if (!secret) return null;
  return crypto.createHash('sha256').update(`${secret}.${process.env.STRIPE_WEBHOOK_SECRET ?? ''}`).digest('hex').slice(0, 32);
}

function hasStaffCookie(req) {
  const want = expectedCookie();
  if (!want) return false;
  const cookies = Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')));
  return cookies[COOKIE] === want;
}

async function activeBookings() {
  const keys = await kvKeys('booking:*');
  const out = [];
  for (const k of keys) {
    const b = await kvGet(k);
    if (b) {
      const rec = typeof b === 'string' ? JSON.parse(b) : b;
      if (rec.state !== 'returned') out.push(rec);
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export default async function handler(req, res) {
  const gate = process.env.STAFF_GATE;

  if (req.method === 'GET') {
    const provided = req.query?.gate;
    if (provided) {
      if (gate && provided === gate) {
        const cookieValue = expectedCookie();
        res.setHeader('Set-Cookie', `${COOKIE}=${cookieValue}; Path=/; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax`);
        return res.status(200).json(await dashboard());
      }
      return res.status(401).json({ error: 'wrong gate' });
    }
    if (hasStaffCookie(req)) {
      return res.status(200).json(await dashboard());
    }
    return res.status(401).json({ error: 'staff gate required' });
  }

  if (req.method === 'POST') {
    if (!hasStaffCookie(req)) {
      // First-time action from the form: accept the gate directly.
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!(gate && body.gate === gate)) return res.status(401).json({ error: 'staff gate required' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const ref = String(body.ref ?? '').toUpperCase();
    const action = body.action;
    if (!/^[A-Z0-9]{6,16}$/.test(ref) || !['collect', 'return', 'unreserve'].includes(action)) {
      return res.status(400).json({ error: 'bad action or ref' });
    }

    const raw = await kvGet(`booking:${ref}`);
    if (!raw) return res.status(404).json({ error: 'unknown booking' });
    const booking = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const now = new Date().toISOString();
    const allowed = {
      collect: ['reserved', 'returned'],
      return: ['collected'],
      unreserve: ['collected', 'returned', 'reserved'],
    };
    if (!allowed[action].includes(booking.state)) {
      return res.status(409).json({ error: `cannot ${action} from state ${booking.state}` });
    }
    const states = { collect: 'collected', return: 'returned', unreserve: 'reserved' };
    booking.state = states[action];
    booking.history = [
      ...(booking.history ?? []),
      { action, at: now },
    ];
    await kvSet(`booking:${ref}`, booking);
    return res.status(200).json({ ref, state: booking.state });
  }

  return res.status(405).json({ error: 'GET or POST' });
}

async function dashboard() {
  const items = await activeBookings();
  const today = new Date().toISOString().slice(0, 10);
  return {
    gate: 'ok',
    createdAtToday: items.filter((b) => (b.createdAt ?? '').slice(0, 10) === today).length,
    bookings: items.map((b) => ({
      ref: b.ref,
      amount: b.amount,
      state: b.state,
      createdAt: b.createdAt,
      email: b.email,
      items: b.items ?? [],
      history: b.history ?? [],
    })),
  };
}