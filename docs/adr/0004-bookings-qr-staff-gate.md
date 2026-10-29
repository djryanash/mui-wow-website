# 0004 — Bookings, QR hand-over, and the staff gate

Date: 2026-10-29
Status: Accepted

## Context

Rentals (beach chairs, bean bags, the sunset picnic hamper) are paid
through the site (Stripe Checkout), collected at the beach on the day,
and returned at day's end. Payment confirmation email carries a QR that
must support: the customer presenting it, the owner scanning it with an
iPhone, marking 'collected', and later 'returned'; end of day = an
honest list of what is still out.

The commercial layer was deliberately deferred at launch (ADR 0001
anticipated); this ADR records the wiring once it landed.

## Decision

- **Cart**: browser-localStorage, one line item per product slug. No
  accounts, no server cart. Checkout posts the cart to
  `POST /api/checkout`, which resolves each slug's active HKD price by
  Stripe product metadata (`metadata.slug` is the join key across BOTH
  worlds) and creates a hosted Checkout Session. Prices are resolved at
  request time so the YAML never stores more than the live price id.
- **Products**: one product = one YAML in `src/products/` (ADR 0001's
  convention, undated slugs). Absent `stripePriceId` → "coming soon"
  CTA; present → checkout. `displayPrice.amount` is cents (HKD); the
  daily cross-check fails the build if Stripe disagrees.
- **The booking**: `checkout.session.completed` → webhook verifies the
  signature (two-step HMAC, no SDK, 5-minute replay window), claims the
  once-only guard `processed:<sessionId>` (SETNX, 30 days), and writes
  `booking:<ref>` (ref derived from the session id) with state
  `reserved`. Guard rollback on failure = Stripe's next delivery retries.
- **Two rhythms, one code**: the QR encodes `/<origin>/booking/<ref>`.
  Customers (no cookie) get read-only facts. Staff (a valid
  `muiwow_staff` cookie) get the collect/return actions on the SAME
  page. Staff also get `/staff` (dashboard: items out, actions).
- **Staff auth = a single secret gate, not accounts**: `/staff?gate=<STAFF_GATE>`
  validates against an env secret and sets a signed (HMAC of gate +
  webhook secret) month-long cookie. Rotation = one env change. The
  customer-facing view carries no mutation power — the customer's
  confirmation email containing the QR must not let them mark their own
  hamper as collected (the anti-fraud line that makes the gate exist).

## Alternatives considered

Full account system (Auth.js etc.): rejected for a one-person beach
operation; heavy, and the problem is authentication of one person, not
identity management. Customer QR carrying staff powers: rejected — the
email the customer holds would become the key to their own collection
record. Vercel KV: replaced by Upstash (integration still injects the
KV_* variable names; the code binds to those, not to Upstash marketing
names).

## Consequences

- Booking states: reserved → collected → returned (+ unreserve escape).
  State history with timestamps is embedded in the record.
- Emails: QR generated server-side (qrcode lib), sent via Resend; the
  from-address is the Resend sandbox (`onboarding@resend.dev`) until the
  custom domain is verified (then RESEND_FROM overrides). Email failure
  is best-effort and logged — the booking always exists, the staff page
  is the recovery path.
- The webhook secret is per-world: the sandbox endpoint's secret lives
  in the envs while testing; going live = live-endpoint secret + swap
  STRIPE_API_KEY in envs (prices resolve by metadata, so the YAML
  survives unchanged).
- Testing: checkout ran against the sandbox with a HK$10 price; the
  real HK$600 price is deactivated in Stripe until selling starts.