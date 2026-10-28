# CONTEXT.md — Mui WoW website

A glossary of the domain language for the Mui WoW community events website.
Plain definitions only. Implementation lives in code and specs, not here.

## Glossary

### Event

A single community gathering Mui WoW organises (for example, a movie night
at Silvermine Beach). An Event has a fixed date and start time, a venue,
at least one public image (poster/flyer), descriptive copy, and any number
of Registration Items. One Event = one content record, and everything on
the site (hero, cards, event page) derives from it. Compare: Class (the
Brightwater Academy concept this system was ported from) — an Event is
free to attend and public-held, a Class was a paid cohort.

### Featured Event (Hero Event)

The next upcoming Event by start date. Always occupies the hero position
on the home page. As soon as the Featured Event is past, the next upcoming
Event takes the hero position automatically. "Past" means the Event has
ended, not that its final activity has started.

### Upcoming Event

An Event whose start date–time is still in the future. Every Upcoming
Event that is not the Featured Event appears as a card on the home page
linking to its Event Page.

### Past Event

An Event whose end time has passed. An event without a known end time
becomes Past at the close of its final day, meaning 12:00 AM the day
AFTER the Event. A known end time in the Event's record always wins over
that midnight boundary.
Past Events leave the card list and live in the Past Events strip on the
home page (the three most recent, linking to their still-live Event
Pages) until a dedicated archive becomes worthwhile.

### Registration

Signing up for part of an Event through an external service (Eventbrite
today). Entrance to Mui WoW Events is always free; the site itself handles
no admission charges. A Registration link always points outside the site.

### Registration Item

A bookable slice of an Event, such as a craft session or a rented seat.
Each Registration Item carries its own external link (Eventbrite today)
and display copy such as "last seats available", set by hand.

### Rental Item

A piece of physical equipment offered at an Event (beach chairs, bean
bags, blankets, and similar). Rentals are the only way Mui WoW makes
money at events, because venues are public spaces. Today a Rental Item
appears as display copy with a manual reserve action; later it may become
a directly bookable, paid item (Stripe Payment Links anticipated in the
data contract, not built yet).

### Quiet Period

A stretch of days when no Upcoming Event exists on the site. Not an error
state: the hero keeps its animation and promotes beach equipment rentals
instead, pointing at the Supplies and Rentals page.

### Hero Effect

The optional animation style shown behind the Featured Event in the hero
(fireworks by default, or a themed style such as floating petals for a
Day of the Dead event). Content chooses the effect, so a new event can
surprise visitors without code changes. Honors visitors' reduced-motion
preference, falling back to a static glow.

### Mui WoW

The public-facing brand name of the organisation behind the Events
("MUI WOW by KRAF CONCEPTS" on the About page and footer). Brand theme:
tropical beach party meets festive celebration (buffalo mascot, palms,
disco ball, balloon arches). Palette and feel see LOGO_ANALYSIS.md.

### KRAF CONCEPTS

The company behind Mui WoW. Named as the legal/parent identity next to
the brand (footer, About page), never the headline.