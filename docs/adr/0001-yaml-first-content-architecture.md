# 0001 — YAML-first content architecture

Date: 2026-10-28
Status: Accepted

## Context

The Mui WoW website lists community events. The next upcoming event must
occupy the hero position automatically, every other upcoming event gets a
card, past events move to a strip. There will be a handful of events per
year, created irregularly by a non-technical owner (Gaston / KRAF
CONCEPTS). Payments may arrive later (equipment rentals via Stripe), and
registration exists first as external Eventbrite links.

The pattern is a port of the Brightwater Academy "class YAML system"
(see CLASS-YAML-SYSTEM.md), itself proven in production.

## Decision

One event = one YAML file in `src/events/`, file name = slug. A zod
schema validates every file at build (typos fail the build loudly). A
prebuild script emits the validated subset to `public/events.json`,
committed, which is both the build-time input for pages and the only
runtime data surface. There is no CMS, no database.

Slug immutability: once published anywhere (IG bio, print), a slug never
changes; renames require `redirectFrom` + `allowSlugChange` together.

Event URL: `/event/<slug>` under the default locale.

## Alternatives considered

Headless CMS — rejected: infrastructure for a problem this volume does
not have. Database-driven app — rejected: breaks the static-first
hosting model and adds an attack/maintenance surface for free-entrance
community events.

## Consequences

- Adding an event = add one YAML file, push to GitHub.
- The schema is the contract; unknown fields fail validation.
- Later payment wiring hangs off event records (`rentalItems[].bookingUrl`),
  which the emitter already passes through; nothing above the data layer
  changes when Stripe arrives.