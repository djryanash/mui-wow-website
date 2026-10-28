# Mui WoW website

Mui WoW is a Mui Wo community events brand (MUI WOW by KRAF CONCEPTS).
Static, trilingual (English / Spanish / Cantonese), Astro on Vercel.

## How content works (ADR 0001)

One event = one YAML file in `src/events/`, file name = slug, slug ends
in `-yyyy-mm-dd`. Everything on the site derives from those files plus
`src/data/site.yaml`. Copy fields are language objects:
`{ en: required, es?, zh? }` — a missing translation falls back to
English (ADR 0003).

```text
src/events/*.yaml ──(npm run prebuild)──▶ public/events.json  (committed)
```

Add an event: drop a YAML file, push to GitHub. Done — Vercel deploys.

## Commands

```sh
npm install          # once
npm run dev          # local dev server
npm run build        # validate + emit events.json + static build
npm run check:data   # validation gate reports
```

## Rotation rules (ADR 0002)

The next upcoming event holds the hero. An event is Past at its known
`end` time, or at 12:00 AM the day after its day when there is no known
end. A scheduled GitHub Action (`daily-rotation`, 16:05 UTC) POSTs the
Vercel Deploy Hook to rebuild main right after midnight HKT. The workflow
fails loudly if `VERCEL_DEPLOY_HOOK_URL` is not set in repo secrets.

## Deployment rule

GitHub is the single source of truth. Pushes auto-deploy on Vercel;
deploys never happen any other way.

## Phase roadmap

- Phase 1 (live): events, registration via external event links
  (Eventbrite), rentals as display copy with reserve-by-contact CTA.
- Phase 2: equipment rentals become bookable — Stripe Payment Links fill
  `rentalItems[].bookingUrl` per event; the schema already carries the
  field, nothing else changes.

## Validation

`npm run build` fails loudly on: YAML parse errors, schema violations
(unknown fields, missing English, naive timestamps without a +08:00
offset, non-https links). `npm run check:data` prints the current
selection state (featured, upcoming, past strip, language statuses).

## Notes

- Rentals page ships as "Coming Soon" until the owner's catalogue arrives.
- Language picker visibility is a content state: `languagePicker:` and
  the per-locale switches in `src/data/site.yaml`.