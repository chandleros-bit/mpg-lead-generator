// lib/verticals/auto_repair.js
// Independent auto repair. Moved here from fetcher/scoring/processors with no
// behavior change; see docs/superpowers/specs/2026-09-07-auto-repair-vertical-design.md.

export default {
  id: "auto_repair",
  label: "Auto repair",
  noun: "repair shop",

  search: {
    place_types: ["car_repair"],
    // Specialty phrasings, ordered roughly by ticket size. Google ranks a bare
    // "car repair" nearby query on prominence, and the highest-ticket
    // independents are rarely the most prominent. Text Search reaches them by
    // the work they do.
    text_queries: [
      "transmission repair shop",
      "European auto repair",
      "diesel repair shop",
      "collision repair shop",
      "brake and suspension shop",
      "auto repair shop",
      "tire and lube shop",
    ],
  },

  exclude_chains: [
    "Jiffy Lube", "Take 5 Oil Change", "Valvoline", "Firestone Complete Auto Care",
    "Christian Brothers Automotive", "Midas", "Meineke", "Meineke Car Care Center",
    "AAMCO", "Pep Boys", "Precision Tune Auto Care", "Brake Check", "Just Brakes",
    "Kwik Kar", "Grease Monkey", "Monro Auto Service", "Big O Tires",
    "Tires Plus", "Discount Tire", "NTB", "Mavis Discount Tire",
    "Mavis Tires & Brakes", "Sun Auto Tire & Service", "Goodyear Auto Service",
    "Caliber Collision", "Service King", "Gerber Collision", "Crash Champions", "Maaco",
    "AutoZone", "O'Reilly Auto Parts", "NAPA Auto Parts", "Advance Auto Parts",
  ],

  // Shop-management platforms that bundle their own payments. A shop on one of
  // these took the processor that came with the software and never had it
  // quoted. Signatures are deliberately narrow: "shopware" alone is a German
  // ecommerce platform, so only the auto vendor's hyphenated domain counts.
  software: {
    Tekmetric: ["tekmetric.com", "tekmetric.io"],
    Shopmonkey: ["shopmonkey.io", "shopmonkey.com"],
    "Shop-Ware": ["shop-ware.com"],
    AutoLeap: ["autoleap.com"],
    Protractor: ["protractor.net"],
    "Mitchell 1": ["mitchell1.com", "mitchellrepair.com"],
  },
  software_chip: "shop software",

  // Work that carries a materially larger repair order than routine service.
  // "euro*" reaches European and the EuroTech / Euro Auto Werks shorthand;
  // "turbo*" reaches turbocharger.
  high_ticket_keywords: [
    "transmission", "rebuild", "engine replacement", "head gasket", "timing belt",
    "turbo*", "diesel", "duramax", "cummins", "powerstroke",
    "euro*", "german", "bmw", "mercedes", "audi", "porsche", "land rover",
    "collision", "body shop", "fleet",
  ],
  // Posted hourly labor rates show up in shop reviews. No other vertical bills
  // by the hour in a way reviews quote, so only auto reads them.
  labor_rate: true,

  // A shop turns far fewer tickets than a restaurant, but each is worth two
  // orders of magnitude more, so monthly card volume lands in the same band.
  volume: 0.95,
  decision_makers: ["Owner", "Service manager"],
};
