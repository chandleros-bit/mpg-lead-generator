import { isShopManagement } from "./processors.js";

// Where the run is. One market per run, chosen on the dashboard. The default
// is the original home market so a call with no market reads as it always did.
export const DEFAULT_MARKET = { city: "Houston", state: "TX" };

function area(market) {
  return (market && market.city) || DEFAULT_MARKET.city;
}

// Cash discount is the only setup we pitch anywhere, because it is legal in all
// 50 states. Texas gets named because Tex. Bus. & Com. Code 604A.0021 still
// bans surcharges on its face; elsewhere the reason is that the rules vary.
function cashDiscountReason(market) {
  const st = ((market && market.state) || DEFAULT_MARKET.state).toUpperCase();
  return st === "TX" ? "Texas is particular about that last part" : "Card fee rules vary by state";
}

function footer(personal) {
  const f = personal.canspam_footer;
  return `\n\n—\n${personal.name}, ${personal.company}\n${f.business_address}\n${f.optout_line}`;
}

function greeting(lead) {
  const owner = lead.business.owner;
  if (owner && owner.name) {
    const first = String(owner.name).trim().replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0];
    if (first) return `Hi ${first},`;
  }
  return `Hi ${lead.business.name} team,`;
}

function displacement(lead, personal, market) {
  const name = lead.business.name;
  const vertical = lead.business.category.replace(/_/g, " ");
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;

  return {
    place_id: lead.business.place_id,
    email1_subject: `Quick question about card processing at ${name}`,
    email1_body:
      `${greeting(lead)}\n\n` +
      `I work with ${vertical} businesses around ${area(market)} on their card ` +
      `processing, and a couple of your reviews caught my eye. Would you be ` +
      `open to a two-minute look at your current effective rate? Most ` +
      `${vertical}s I review are overpaying and don't realize it — no ` +
      `long-term contract on our side either.\n\n` +
      `Worth a quick look?\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: card processing at ${name}`,
    email2_body:
      `Hi again,\n\n` +
      `One concrete thing: if you're on flat-rate pricing (Square, Clover, ` +
      `and similar), switching to interchange-plus usually drops the ` +
      `effective rate noticeably at your volume. I'm happy to read your ` +
      `latest statement and tell you straight whether it's worth changing.\n\n` +
      `Reply here or call/text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name} — ${who} with ${company}. Saw your spot and think you may be ` +
      `overpaying on card fees. Open to a quick rate check? No contract.`,
    voicemail:
      `Hi, this is ${who} with ${company}. I help local ${vertical}s cut their ` +
      `card-processing costs without locking into a contract. If you'd like a ` +
      `free rate review, call me back at ${personal.callback_number}. Thanks!`,
  };
}

function greenfield(lead, personal, market) {
  const name = lead.business.name;
  const vertical = lead.business.category.replace(/_/g, " ");
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;

  return {
    place_id: lead.business.place_id,
    email1_subject: `Congrats on ${name} — payments set up right`,
    email1_body:
      `${greeting(lead)}\n\n` +
      `Congrats on the new ${vertical}! When you're getting set up to take ` +
      `cards, the choices you make now are hard to undo later. I help new ` +
      `businesses in ${area(market)} start on transparent pricing and the right hardware ` +
      `from day one.\n\n` +
      `Want a quick rundown of what to look for?\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: getting ${name} ready to take cards`,
    email2_body:
      `Hi again,\n\n` +
      `Quick tip for a new ${vertical}: avoid leased terminals and flat-rate ` +
      `lock-ins — they're easy to sign up for and expensive to leave. I can ` +
      `walk you through getting started on interchange-plus with EMV/NFC ` +
      `hardware so you're ready for chip and tap on opening day.\n\n` +
      `Reply here or call/text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name} — ${who} with ${company}. Congrats on opening! Happy to help ` +
      `you get card payments set up right from the start. Want a quick tip sheet?`,
    voicemail:
      `Hi, this is ${who} with ${company}. Congratulations on the new ${vertical}! ` +
      `I help new businesses get payments set up right the first time. Give me ` +
      `a call back at ${personal.callback_number} whenever's good. Thanks!`,
  };
}

// ---------------------------------------------------------------------------
// Auto repair
//
// Two things separate this copy from the generic version above, and both come
// straight from the vertical: the ticket is large enough that the fee is a
// number an owner can picture, and the owner is on the premises to hear it.
//
// Three hard rules are baked in, because getting any of them wrong is worse
// than not sending the email at all:
//
//   1. The Visa/Mastercard interchange settlement is PENDING. It took
//      preliminary approval on June 9, 2026 with a fairness hearing set for
//      November 16, 2026, and merchant groups have said they will appeal. The
//      copy says the rules are changing. It never says they changed, and never
//      promises anyone's fees are coming down.
//   2. In Texas this is DUAL PRICING, never surcharging. Tex. Bus. & Com. Code
//      604A.0021 still bans credit surcharges on its face; the Rowell v. Paxton
//      injunction protects only the merchants who were party to it. The word
//      "surcharge" does not appear in anything we send.
//   3. No savings figure before a statement. Every number in the copy is the
//      merchant's own arithmetic on their own volume, or it is an offer to go
//      find the number. It is never a promise.
//
// test/campaigns.test.js asserts all three against the generated text.
// ---------------------------------------------------------------------------

// The management platform on the shop's own site, when we fingerprinted one.
// Naming it is credible because it is a fact about their software. We do not
// name a processor the same way: that would be guessing out loud.
function shopPlatform(lead) {
  const found = (lead.business && lead.business.processor) || [];
  return found.find((n) => isShopManagement(n)) || null;
}

function autoRepairDisplacement(lead, personal, market) {
  const name = lead.business.name;
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;
  const platform = shopPlatform(lead);

  const platformLine = platform
    ? `I also noticed you are running ${platform}. Most shops on a system like ` +
      `that took the payment processing that came bundled with it and never ` +
      `had it quoted against anything. That is not a knock on the software, ` +
      `it is just how those deals are packaged.\n\n`
    : "";

  return {
    place_id: lead.business.place_id,
    email1_subject: `Card rules are changing in 2026, quick question about ${name}`,
    email1_body:
      `${greeting(lead)}\n\n` +
      `The Visa and Mastercard settlement cleared its first court approval in ` +
      `June and has a hearing set for November. It is not final yet, and ` +
      `nobody should be told their fees are about to drop. What it does mean ` +
      `is that the rules around card pricing are moving for the first time in ` +
      `years, and it is a reasonable moment to look at what you are actually ` +
      `paying.\n\n` +
      `Here is the part most shop owners have never run: on a $700 repair ` +
      `order at a typical rate you are handing the card networks somewhere ` +
      `north of $20. Do that a couple hundred times a month and it is real ` +
      `money leaving the shop.\n\n` +
      `I do a free 15 minute processing audit for repair shops around ${area(market)}. ` +
      `Send me last month's statement, or a photo of it, and I will send back ` +
      `a one page breakdown of your real cost per repair order. No obligation ` +
      `and nothing to sign.\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: what you are paying per repair order at ${name}`,
    email2_body:
      `Hi again,\n\n` +
      platformLine +
      `The fix most shops land on is dual pricing. Your posted price is the ` +
      `card price, and customers who pay cash get a disclosed discount off it. ` +
      `It is legal in all 50 states when it is set up that way, the pricing is ` +
      `shown before the sale, and there is no separate fee line added to the ` +
      `card receipt. ${cashDiscountReason(market)}, which is why I ` +
      `set it up as a cash discount rather than the other way around.\n\n` +
      `I cannot tell you what you would save until I have read your statement, ` +
      `and I would not want to guess. Send me one month and I will tell you ` +
      `straight whether it is worth changing anything.\n\n` +
      `Reply here or call or text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name}, this is ${who} with ${company}. I run free 15 minute ` +
      `processing audits for repair shops around ${area(market)}. Send me last month's ` +
      `statement and I will show you your real cost per repair order. No ` +
      `obligation.`,
    voicemail:
      `Hi, this is ${who} with ${company}. I work with independent repair ` +
      `shops around ${area(market)} on card processing. With the Visa and Mastercard ` +
      `rules changing this year I am doing free 15 minute audits, where I read ` +
      `your statement and show you what you are paying per repair order and a ` +
      `legal way to cut it. My number is ${personal.callback_number}. Thanks.`,
  };
}

function autoRepairGreenfield(lead, personal, market) {
  const name = lead.business.name;
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;

  return {
    place_id: lead.business.place_id,
    email1_subject: `Congrats on ${name}, a word on how you take cards`,
    email1_body:
      `${greeting(lead)}\n\n` +
      `Congrats on opening. One thing worth getting right early: whatever shop ` +
      `management software you settle on will offer you its own bundled ` +
      `payment processing, and it is easy to accept that as simply the rate. ` +
      `It usually is not, and it is harder to unwind a year in than it is to ` +
      `set up correctly now.\n\n` +
      `On repair orders your size the card fee is one of the larger line items ` +
      `you will carry, so it is worth ten minutes before you are locked in. ` +
      `Happy to walk you through what to look for, including dual pricing, ` +
      `which lets the cash customer take a disclosed discount off your posted ` +
      `price. It is legal in all 50 states when it is built that way.\n\n` +
      `Want the rundown?\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: getting ${name} set up to take cards`,
    email2_body:
      `Hi again,\n\n` +
      `Two things I would avoid on day one: a leased terminal, which is cheap ` +
      `to sign and expensive to leave, and a flat rate quoted with no ` +
      `interchange breakdown, which hides where the money actually goes.\n\n` +
      `The card rules are also moving right now. The Visa and Mastercard ` +
      `settlement took preliminary approval in June with a hearing this ` +
      `November, so it is not settled law yet, but it is a good reason to ` +
      `start on a setup you can change later rather than one you cannot.\n\n` +
      `Reply here or call or text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name}, this is ${who} with ${company}. Congrats on opening. Before ` +
      `you take the payment processing your shop software offers, want a quick ` +
      `rundown on what to look for? No cost.`,
    voicemail:
      `Hi, this is ${who} with ${company}. Congratulations on the new shop. I ` +
      `help independent repair shops get card payments set up right the first ` +
      `time, before the software bundles a rate you never shopped. Call me ` +
      `back at ${personal.callback_number} whenever is good. Thanks.`,
  };
}

// Vertical-specific copy, keyed by vertical then track. Anything not listed
// here falls through to the generic pair above unchanged.
export const VERTICAL_COPY = {
  auto_repair: { displacement: autoRepairDisplacement, greenfield: autoRepairGreenfield },
};

export function generateCampaign(lead, personal, market = DEFAULT_MARKET) {
  const track = lead.track === "greenfield" ? "greenfield" : "displacement";
  const vertical = (lead.business && lead.business.category) || "";
  const override = (VERTICAL_COPY[vertical] || {})[track];
  if (override) return override(lead, personal, market);
  return track === "greenfield" ? greenfield(lead, personal, market) : displacement(lead, personal, market);
}
