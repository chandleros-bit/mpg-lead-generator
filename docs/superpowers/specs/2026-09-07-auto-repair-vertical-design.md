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
- Review keyword groups split: dual-pricing language out of `FEE_KEYWORDS`
  into its own group (`lib/scoring.js`, `public/dashboard.js`). Applies to
  every vertical, not just this one.
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
shop's name and the reviews Google surfaced. They match on whole words plus an
optional plural, not on substrings: the keyword is printed straight back to the
rep as a chip, so a hit inside an unrelated word ("Neuro Motors", "a fleeting
visit") is a wrong claim on the lead card, not just a stray point. Two keywords
are deliberate prefixes — "euro" has to reach European and the shorthand half
these shops put in their own name, and "turbo" has to reach turbocharger.

A posted labor rate at or above $100/hr is read out of review text — the modal
band in the 2025 PartsTech survey was $120–$159/hr, so $100 is a conservative
floor. It has to be stated as a rate: an amount merely sitting near the word
"labor" is the labor line off an invoice, and a ceiling of $400/hr rejects
anything that gets past that, because a bill read as an hourly is a fabricated
fact rather than a weak signal.

Both are proxies and are weighted as proxies: `high_ticket_max` is 8 against a
displacement scale that already allocates over 100 points. They exist to decide
which of two similar shops gets the drive, not to carry a lead. They are never
quoted to a merchant. The number that goes in front of an owner comes off their
statement.

They are inert for every vertical that has not opted in: a restaurant called
Transmission Tacos scores zero from this.

### 5. A merchant already posting two prices is not a fee complaint

Review mining previously had two keyword groups, fees and friction, and
dual-pricing language was folded into fees. That mislabels the best lead on the
board. A customer writing "they add 3% on cards" is a complaint; a shop posting
"cash price / card price" is a merchant already doing the thing this pitch
sells, usually built wrong, and the rep opens on "let me make sure that is set
up legally" rather than "your fees are high". Same points either way, different
chip, different call.

`DUAL_PRICING_KEYWORDS` is now its own group ("cash discount", "cash price",
"card price", "dual pricing", "non-cash adjustment"), chipped as *cash/card
pricing in reviews — already running dual pricing*. `keyword_pain_max` is 12 and
each group pays 6, so a third group cannot lift the track's ceiling — it only
changes which two of the three get paid. Asserted in `test/auto_repair.test.js`.

This is not auto-repair-specific and is deliberately not gated to the vertical:
a restaurant posting a cash price is the same conversation. It is listed here
because this branch is where the keyword list was touched.

### 6. The copy holds three rules, and the tests enforce them

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
3. **No savings figure before a statement.** The line is cost versus saving,
   not whether a number appears. Displacement carries one illustration — a $700
   repair order, north of $20 to the networks — and that is a *cost*: what they
   already hand over, arithmetic anyone can check, framed against a repair order
   rather than against their volume. What never appears is the other direction:
   a figure they would get back. The copy says outright that it cannot tell them
   what they would save until it has read a statement. Greenfield carries no
   figure at all, because a shop with no volume yet has nothing to compute from
   and any number there could only be invented. A single month distorts anyway;
   a real quote wants two or three.

`test/auto_repair.test.js` asserts all three against the generated text for
**both tracks**. Rule 3 is enforced three ways, because a banned-phrase list
only catches phrasings someone thought of: the phrase list, a sentence-level
check that no dollar figure ever shares a sentence with a savings word, and a
positive assertion that the refusal-to-quote survives. All three were
mutation-tested — inserting "I will save you $400 a month", adding a figure to
greenfield, and deleting the refusal each fail the suite.

### 7. Auto repair gets more displacement headroom than other verticals, and that stands

Two of this branch's additions only ever pay auto repair. `integrated_software`
is worth 28 where `card_present` is 25, and it fires on shop-management
signatures no restaurant site carries. `high_ticket_max` is 8 and is gated on
`HIGH_TICKET_KEYWORDS`, which only `auto_repair` has an entry in. So the
displacement track now allocates 126 points to an auto shop and 115 to
everything else, against a score clamped at 100 and bucket cuts fixed at 70 hot
/ 40 warm.

The consequence is real and is being accepted rather than corrected: an auto
shop clears *hot* on 70 of 126 available points where a salon needs 70 of 115,
and more auto shops will pile up at exactly 100. Scores are no longer strictly
comparable across verticals on this track.

Three reasons that is the right trade here:

1. The extra headroom is extra *evidence*, not a thumb on the scale. Both new
   sources are things we actually observed — a platform on their own site, and
   language in their own name and reviews. A vertical with more visible signal
   earning a higher ceiling is the system working.
2. Confidence does not move with it. `collectSignals` pays no signal for
   high-ticket points, so a shop riding specialty keywords into a higher score
   carries exactly the confidence it had without them — an identical auto shop
   and salon score 39 and 31 and both read `medium` on `["rating_dissatisfaction"]`.
   A score inflated by proxies is precisely what the confidence axis was added
   to expose, and it still exposes it.
3. Ordering already breaks ties on evidence, not on the score alone. Leads sort
   by bucket, then confidence, then score, so shops stacked at the ceiling are
   separated by how much of that ceiling is corroborated.

Greenfield is untouched: it allocates 40 + 30 + 27 + 3 = 100 for every vertical,
and auto repair's specialty keywords pay nothing there — they only add a routing
chip. The cross-vertical comparison that matters for a new-business list is
therefore unaffected.

Normalizing each track to a fixed 100 would restore strict comparability and is
the obvious alternative. It is not worth doing yet: it would reprice every score
on record for a distortion that only bites when ranking an auto shop directly
against a salon, which is not how the list is worked. Revisit if a second
vertical gets its own point sources, at which point the ceilings start diverging
in more than one direction.

## Verification

`npm test` — 213 tests, all passing. New coverage in
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
