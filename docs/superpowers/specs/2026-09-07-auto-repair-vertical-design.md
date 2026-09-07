# MPG Lead Generator — Auto Repair Vertical Spec

**Date:** 2026-09-07
**Owner:** Chandler Atkinson (Media Payments Group sales role)
**Status:** Implemented on `feat/auto-repair-vertical`

## Purpose

Add auto repair as a first-class vertical, ahead of veterinary, per the vertical
expansion plan. Auto repair is standard-risk, card-present, physically located,
owner-operated, and high-ticket: the 2025 OEC/PartsTech survey of 752 U.S. shops
put 36% of shops at an average repair order of $500–$749, and Tekmetric's 2023
index put its platform ARO at $585.91. Roughly 79,000 shops nationally, the
large majority of them independents, means the decision-maker is on the premises
and there is no procurement department in the way.

The pitch is dual pricing, and the dollars are what sells it. A shop turning a
few hundred repair orders a month at a few percent is losing thousands, and the
generator's job is to find the shops where that number is largest and the
incumbent relationship is weakest, before the first dial.

## Scope

**In scope:**
- `auto_repair` split out of the generic `auto` bucket (`lib/fetcher.js`,
  `lib/scoring.js`, `config.json`, `public/config.json`).
- Places Text Search as a second discovery path (`lib/fetcher.js`).
- Shop-management platform fingerprinting and a new `integrated_software`
  processor tier (`lib/processors.js`, `lib/scoring.js`).
- High-ticket proxies: specialty keywords and posted labor rate
  (`lib/scoring.js`).
- Auto-repair outreach copy with the settlement hook and dual-pricing framing
  (`lib/campaigns.js`).
- Auto repair chain exclusions (`config.json`).
- Vertical filter chip and a `Matched Query` CSV column (`public/`).

**Out of scope (next):**
- The veterinary vertical, which reuses all of this plus TBVME licensee
  enrichment.
- The statement-analysis calculator and its one-page PDF. That is a separate
  deliverable; this repo only has to make the offer credible enough to get the
  statement.
- Texas Comptroller / HCAD owner enrichment for auto shops. Auto repair has no
  statewide license registry to scrape, so the Comptroller sales-tax-permit
  location API is the right active-status cross-check, and it is not wired up
  here.

## Decisions

### 1. Auto repair is its own vertical, not part of `auto`

`auto` previously bundled `car_repair`, `car_wash`, and `auto_parts_store`.
A repair order is several hundred dollars; a car wash is ten. They do not share
a volume profile, a decision-maker, or a pitch, and averaging them made the
whole bucket score like the cheapest member. `car_repair` now normalizes to
`auto_repair`; `car_wash` and `auto_parts_store` keep the old bucket.

`VERTICAL_VOLUME.auto_repair` is 0.95, sitting with the food verticals. A shop
turns far fewer tickets than a restaurant, but monthly card volume — the thing a
residual is actually paid on — lands in the same band.

### 2. Text Search supplements Nearby Search, and its results are re-checked

Google has exactly one Table A type for the whole repair trade: `car_repair`.
A bare nearby search on it ranks by prominence, and the highest-ticket
independents — transmission, European, diesel, collision — are rarely the most
prominent. Text Search reaches them by the work they do.

Text Search is not type-constrained the way Nearby Search is, so every result is
checked against the vertical's own type list (`placeMatchesVertical`) before it
is tagged in-ICP. Without that check a "brake shop" query tags a dealership as a
repair lead and the whole pitch lands wrong. A result with no `primaryType` at
all is rejected rather than assumed: unverifiable is not qualified.

The sweep runs after the type search, so a shop found both ways keeps its Nearby
record. Per-query failures are swallowed — a partial specialty sweep still beats
the bare type search it supplements. It costs one extra API call per query per
run, only for verticals that define queries.

### 3. Shop-management software is a stronger signal than a POS fingerprint

A shop on Tekmetric, Shopmonkey, Shop-Ware, AutoLeap, Protractor, or Mitchell 1
took the payment processing that came bundled with the software. It was never
quoted against anything, so there is usually no incumbent relationship to
displace, only a default to replace. That is the highest-intent thing visible
from outside the business, so it gets its own tier (`integrated_software`,
default weight 28) ranked above `card_present` (25).

Signatures are deliberately narrow. Bare `shopware` is **not** a signature:
Shopware is also a large German ecommerce platform, and a loose match would tag
every store running it as an auto shop. Only `shop-ware.com` counts.

The platform name is safe to say out loud in an email, because it is a fact
about their software. A fingerprinted *processor* is not, because that is a
guess; the copy names the platform and never names the processor.

### 4. High-ticket proxies nudge the ranking, they never leave the building

Specialty keywords (transmission, diesel, euro, collision, and so on) read the
shop's name and the reviews Google surfaced. A posted labor rate at or above
$100/hr is read out of review text — the modal band in the 2025 PartsTech survey
was $120–$159/hr, so $100 is a conservative floor.

Both are proxies and are weighted as proxies: `high_ticket_max` is 8 against a
displacement scale that already allocates over 100 points. They exist to decide
which of two similar shops gets the drive, not to carry a lead. They are never
quoted to a merchant. The number that goes in front of an owner comes off their
statement.

They are inert for every vertical that has not opted in: a restaurant called
Transmission Tacos scores zero from this.

### 5. The copy holds three rules, and the tests enforce them

This is the part with legal exposure, so it is asserted rather than trusted.

1. **The settlement is pending.** Preliminary approval June 9, 2026; fairness
   hearing November 16, 2026; NRF, NACS, Walmart and the National Restaurant
   Association object, and NACS has said it will appeal. The copy says the rules
   are changing. It never says they changed, and never says anyone's fees are
   coming down. The relief is also thinner than the headline suggests — premium
   rewards cards, the large majority of consumer volume, are not capped — so
   "your fees are dropping" would be wrong on the merits as well as premature.
2. **In Texas this is dual pricing, never surcharging.** Tex. Bus. & Com. Code
   §604A.0021 still bans credit surcharges on its face. The *Rowell v. Paxton*
   injunction protects only the merchants who were party to it, and AG Opinion
   KP-0257 says the statute may still be enforceable against everyone else. The
   89th Legislature did not change it in 2025. The word "surcharge" does not
   appear in anything the tool generates. The mechanic sold is a posted card
   price with a disclosed cash discount, and no separate fee line on the card
   receipt — a fee line converts it into a surcharge and walks straight into
   §604A.0021.
3. **No savings figure before a statement.** Every number in the copy is the
   merchant's own arithmetic on their own volume, or an offer to go find the
   number. A single month distorts anyway; a real quote wants two or three.

`test/auto_repair.test.js` asserts all three against the generated text for both
tracks, including a banned-phrase list. If someone later edits the copy into a
promise, the suite fails.

## Verification

`npm test` — 205 tests, all passing. New coverage in
`test/auto_repair.test.js` spans the vertical split, the Text Search path and
its off-type rejection, the fingerprint tier ordering and the Shopware false
positive, the high-ticket proxies, and the three copy rules.

## Open items

- `config.json` still carries the placeholder CAN-SPAM address
  ("123 Example St") and `chandler@mpg.com` rather than the real business
  address and `chandler@mediapaymentsgroup.com`. Every email the tool generates
  carries that footer. This predates this change and needs fixing before the
  first send.
- Comptroller active-status cross-check for auto shops is not wired up. Places
  `businessStatus` is the only liveness check today.
- Number of bays and multi-location, both named in the plan as value proxies,
  are not implemented. Bays are only visible in photos and multi-location needs
  a cross-listing join; neither is cheap enough yet to be worth the false
  positives.
