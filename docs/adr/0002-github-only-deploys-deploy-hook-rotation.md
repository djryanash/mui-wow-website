# 0002 — GitHub-only deploys, deploy-hook daily rotation

Date: 2026-10-28
Status: Accepted

## Context

The site is static (ADR 0001): the Featured Event hero is baked at build
time, so rotation happens on rebuild. Events become Past at their known
end time, or 12:00 AM the day after an event without a known end. The
owner's rule: GitHub is the single source of truth; auto-deploy on push;
never deploy directly to Vercel.

The Brightwater system learned a failure mode the hard way: a Deploy
Hook env var silently missing meant every cron tick reported success
while the landing sold passed dates. "Configured" must be proven, not
assumed.

## Decision

- All deploys flow from pushes to GitHub. Vercel's git integration
  auto-deploys every push; the Vercel CLI is never used to deploy.
- A scheduled GitHub Action (daily, just after 00:00 HKT = 16:00 UTC)
  POSTs the Vercel Deploy Hook URL, which rebuilds the commit already on
  main. No code travels to Vercel; git remains the only deployment path.
- At setup, the Action fails loudly if `VERCEL_DEPLOY_HOOK_URL` is not
  configured — the first tick after an event ends is the wrong moment to
  discover an unwired hook.
- No KV / once-only guard machinery is ported: an hourly class rotation
  needs exactly-once semantics; a daily event rollover does not.

## Alternatives considered

- Client-side rotation (fetch events.json, pick hero in the browser):
  always correct, but puts a fetch and a flash in front of the primary
  screen and hurts SEO for the next event.
- Empty-commit scheduled pushes to main as the rebuild trigger: works
  but pollutes history with one empty commit per day.
- Vercel hourly cron: Hobby tier allows one daily cron only.

## Consequences

A past event can remain in the hero until the daily tick after midnight
HKT; acceptable at event frequency. Rotation precision is the trade for
a build with no secrets, no guards, no serverless functions.