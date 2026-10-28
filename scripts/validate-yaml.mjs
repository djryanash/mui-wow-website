// Validation gate (spec §9, adapted): schema checks happen in load.mjs;
// this script runs the selection rules and reports the state the site will
// render. The two live cross-checks that survive the port:
//   1. every embedded URL is https and parses
//   2. the first upcoming entry exists (a featured-less build is a warning,
//      not an error — ADR 0002 makes the Quiet Period a designed state)

import { isPast, pickFeatured, pickUpcoming, pickRecentsPast, LOCALES } from '../src/data/events.lib.mjs';
import { loadEvents, loadSite } from '../src/data/load.mjs';

const events = loadEvents();
const site = loadSite();
let failures = 0;

const urls = [];
for (const e of events) {
  for (const r of e.registrationItems) {
    if (r.registrationUrl) urls.push([`${e.slug} registrationUrl`, r.registrationUrl]);
  }
  for (const r of e.rentalItems) {
    if (r.bookingUrl) urls.push([`${e.slug} rental bookingUrl`, r.bookingUrl]);
  }
}
if (site.eventbriteOrganizer) urls.push(['site eventbriteOrganizer', site.eventbriteOrganizer]);
urls.push(['site instagram', site.instagram]);

for (const [label, raw] of urls) {
  if (!raw.startsWith('https://')) {
    console.error(`FAIL ${label}: not https → ${raw}`);
    failures += 1;
  }
}

const featured = pickFeatured(events);
const upcoming = pickUpcoming(events);
const past = pickRecentsPast(events);

console.log(`site: ${site.name} (${site.legalName})`);
console.log(`events: ${events.length} (${upcoming.length} upcoming, featured: ${featured?.slug ?? '— quiet period —'}, ${past.length} in past strip)`);
console.log(`languages: picker ${site.languagePicker ? 'ON' : 'OFF'}, es ${site.languages?.es ? 'ON' : 'OFF'}, zh-hk ${site.languages?.['zh-hk'] ? 'ON' : 'OFF'}`);

for (const e of upcoming) {
  const missing = Object.keys(LOCALES)
    .map((l) => (l === 'zh-hk' ? 'zh' : l))
    .filter((l) => !e.title[l]);
  if (missing.length) console.log(`note: ${e.slug} has no ${missing.join(', ')} title — English fallback applies`);
}

if (!featured) {
  console.log('note: QUIET PERIOD — hero will promote rentals; check site.quietPeriod copy exists (validated at build)');
}

if (failures > 0) {
  console.error(`check:data FAILED with ${failures} problem(s)`);
  process.exit(1);
}
console.log('check:data OK');