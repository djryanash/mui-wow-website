# 0003 — Trilingual content with English fallback

Date: 2026-10-28
Status: Accepted

## Context

Mui WoW's audience includes English, Spanish (the owner's events use
Spanish names like "Tarde-citas") and Cantonese-speaking visitors in
Hong Kong. The owner wants a language picker from launch, but
translations may not all exist on day one, and event posters are images
that cannot be re-rendered per language.

## Decision

- Locale structure: English at the root (no prefix), Spanish under
  `/es/`, Cantonese under `/zh-hk/` (traditional characters, Hong Kong).
- Every translatable string (site chrome and event fields) is a language
  object: `{ en: string, es?: string, zh?: string }`. English is required
  and validated; other languages are optional.
- **Fallback rule: a missing translation falls back to English.** Never a
  hidden page, never a blank string, never a build failure.
- The language picker renders per-locale options only when that locale
  has content; with English alone it is not shown. The picker's
  visibility is therefore a content state, not a code change, and can be
  removed or re-added by editing the copy files.
- Posters/flyers stay as-is (single language images).

## Alternatives considered

- English-only launch with a later retrofit: risks copy being scattered
  in components, making a bilingual pass later a rewrite instead of a
  fill-in.
- Machine-translating event copy into all languages eagerly: fast, but
  ships unreviewed Cantonese/Spanish to a community audience; the
  fallback rule gives translations a path to arrive gradually instead.

## Consequences

- Locale prefixes are baked into URLs — reversing means link churn, so
  this is decided before any content exists.
- Copy authored in English is always sufficient; translations are a
  content task with no code dependency.