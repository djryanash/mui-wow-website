// The event/data library. Zod schemas + locale helpers, shared by the
// build-time loader, the emitter, and the validator. Pure .mjs with zero
// Astro dependencies so scripts/ can import it unchanged (port rule:
// pages never read the YAML files directly; they import through here).

import { z } from 'zod';

// ── Language objects ─────────────────────────────────────────────
// Every translatable string is { en (required), es?, zh? } (ADR 0003).
// A missing translation falls back to English — never hidden, never blank.

export const LOCALES = {
  en: { label: 'English', prefix: '' },
  es: { label: 'Español', prefix: '/es' },
  'zh-hk': { label: '廣東話', prefix: '/zh-hk' },
};

export const DEFAULT_LOCALE = 'en';

const languageObject = z
  .object({
    en: z.string().min(1),
    es: z.string().min(1).optional(),
    zh: z.string().min(1).optional(),
  })
  .strict();

/**
 * Pick a string in the requested locale, falling back to English (ADR 0003).
 * Accepts a language object, a plain string (locale-neutral), or undefined.
 */
export function t(value, locale = DEFAULT_LOCALE) {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (languageObject.safeParse(value).success) {
    return value[locale === 'zh-hk' ? 'zh' : locale] ?? value.en;
  }
  return undefined;
}

function localized(value, locale) {
  const translated = t(value, locale);
  // undefined when only the requested locale is missing entirely (no en)
  return translated;
}

// ── Schemas ──────────────────────────────────────────────────────

const isoWithOffset = z
  .string()
  .refine(
    (s) => {
      // Explicit UTC offset REQUIRED (spec §11): "2026-11-01T17:00:00+08:00".
      const m = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      return !!m && !Number.isNaN(Date.parse(s));
    },
    { message: 'must be ISO-8601 with an explicit UTC offset, e.g. 2026-11-01T17:00:00+08:00' },
  );

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-(?!$)[a-z0-9]+)*$/, 'lowercase letters, digits, hyphens')
  .refine((s) => /-\d{4}-\d{2}-\d{2}$/.test(s), 'must end in -yyyy-mm-dd');

const url = z.string().url();

// Registration: an Eventbrite-style link today; external by nature.
const registrationItem = z
  .object({
    name: languageObject,
    note: languageObject.optional(),
    registrationUrl: url.optional(), // absent = "link coming soon" state
    status: languageObject.optional(), // e.g. "Last seats available!"
  })
  .strict();

// Rentals: display-only in phase 1; bookingUrl is the phase-2 Stripe hook.
const rentalItem = z
  .object({
    name: languageObject,
    note: languageObject.optional(),
    price: languageObject.optional(), // display copy, e.g. "HK$50"
    bookingUrl: url.optional(),
  })
  .strict();

export const eventSchema = z
  .object({
    slug,
    published: z.boolean().default(true),
    unlisted: z.boolean().default(false),

    title: languageObject,
    subtitle: languageObject.optional(),
    // Optional art-directed hero title lines (poster-style typography).
    // Each line: { text: languageObject, style: fiesta|script|caps, colors?: [] }.
    // 'fiesta' colors per letter; absent → plain t(title) one-liner.
    titleDisplay: z
      .array(
        z
          .object({
            text: languageObject,
            style: z.enum(['fiesta', 'script', 'caps']),
            colors: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .optional(),

    start: isoWithOffset,
    // Optional: known end wins over the midnight rule. Without `end`,
    // the event becomes Past at 12:00 AM the day AFTER its day (ADR 0002).
    end: isoWithOffset.optional(),

    location: languageObject,
    details: languageObject.optional(),
    highlights: z.array(languageObject).default([]),

    schedule: z
      .array(z.object({ time: z.string().min(1), label: languageObject }).strict())
      .default([]),

    registrationItems: z.array(registrationItem).default([]),
    rentalItems: z.array(rentalItem).default([]),
    // Registration fallback for the event as a whole (Eventbrite page).
    registrationUrl: url.optional(),

    heroEffect: z.enum(['fireworks', 'petals', 'disco']).default('fireworks'),
    // Full-frame overlay PNGs (same size as the hero art, the mask is baked
    // into their transparency): rendered stacked, crossfading/flickering per
    // event via CSS. e.g. /images/events/coco-screen-01.png
    heroOverlays: z.array(z.string()).default([]),
    // Light-mask PNGs (white bulbs on black, full-frame). A plain string =
    // steady cadence; { mask, cadence: 'steady'|'burst' } picks the rhythm.
    heroLights: z
      .array(
        z.union([
          z.string(),
          z
            .object({
              mask: z.string(),
              cadence: z.enum(['steady', 'burst', 'wisp']).default('steady'),
            })
            .strict(),
        ]),
      )
      .default([]),
    // Hero copy extras (replacing the generic CTA row):
    heroTagline: languageObject.optional(),
    heroCta: z
      .object({
        label: languageObject,
        href: z.string().refine((h) => h.startsWith('/') || h.startsWith('https://'), 'site path or https URL'),
      })
      .strict()
      .optional(),

    // Page assets (not emitted to events.json):
    poster: z.string().min(1).optional(), // path under /images/events/
    heroImage: z.string().min(1).optional(), // wide background photo for the hero
    gallery: z.array(z.string()).default([]),
  })
  .strict();

export const siteSchema = z
  .object({
    name: z.string().min(1), // public brand
    legalName: z.string().min(1), // e.g. "MUI WOW by KRAF CONCEPTS"
    tagline: languageObject,
    contact: z.object({ name: z.string(), phone: z.string() }).strict(),
    instagram: url,
    eventbriteOrganizer: url.optional(),
    languagePicker: z.boolean().default(true),
    languages: z
      .object({ es: z.boolean().default(false), 'zh-hk': z.boolean().default(false) })
      .strict()
      .default({}),
    nav: z.array(z.object({ label: languageObject, href: z.string() }).strict()),
    footerNote: languageObject.optional(),
    quietPeriod: z.object({ title: languageObject, body: languageObject }).strict(),
  })
  .strict();

/** Normalize heroLights entries: plain strings become steady-cadence masks. */
export function normalizeLights(ev) {
  return (ev.heroLights ?? []).map((e) =>
    typeof e === 'string' ? { mask: e, cadence: 'steady' } : { mask: e.mask, cadence: e.cadence ?? 'steady' },
  );
}

// ── Rotation rules (spec §6, adapted per ADR 0002) ───────────────────────

/** Past if a known `end` has passed, else at the close of its final day. */
export function isPast(ev, now = new Date()) {
  const n = now.getTime();
  if (ev.end) return Date.parse(ev.end) < n;
  // Start date + 1 day at 00:00 (+08:00), i.e. 12:00 AM the day after.
  const midnightAfter = Date.parse(`${ev.start.slice(0, 10)}T00:00:00+08:00`) + 24 * 60 * 60 * 1000;
  return midnightAfter <= n;
}

export function pickFeatured(list, now = new Date()) {
  return (
    list
      .filter((e) => e.published && !e.unlisted && !isPast(e, now))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null
  );
}

export function pickRecentsPast(list, now = new Date(), count = 3) {
  return list
    .filter((e) => e.published && !e.unlisted && isPast(e, now))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
    .slice(0, count);
}

export function pickUpcoming(list, now = new Date(), cap = Infinity) {
  return list
    .filter((e) => e.published && !e.unlisted && !isPast(e, now))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, cap);
}

/** Centralized date formatting — never format ad hoc in components (spec §11). */
export function formatEventDate(ev, locale = DEFAULT_LOCALE, tz = 'Asia/Hong_Kong') {
  const start = new Date(Date.parse(ev.start));
  return start.toLocaleDateString(
    locale === 'zh-hk' ? 'zh-HK' : locale === 'es' ? 'es-ES' : 'en-HK',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz },
  );
}

export function formatEventTime(ev, locale = DEFAULT_LOCALE, tz = 'Asia/Hong_Kong') {
  const start = new Date(Date.parse(ev.start));
  const end = ev.end ? new Date(Date.parse(ev.end)) : null;
  const f = (d) =>
    d.toLocaleTimeString(
      locale === 'zh-hk' ? 'zh-HK' : locale === 'es' ? 'es-ES' : 'en-HK',
      { hour: 'numeric', minute: '2-digit', timeZone: tz },
    );
  return end ? `${f(start)} – ${f(end)}` : f(start);
}