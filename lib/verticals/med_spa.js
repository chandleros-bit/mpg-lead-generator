// lib/verticals/med_spa.js
// Medical spas. Google has no med spa type: they are filed under spa, skin care
// clinic, beauty salon, medical clinic, wellness center. So every result, from
// Nearby or Text Search, must carry a med spa word in its name to count.

export default {
  id: "med_spa",
  label: "Med spas",
  noun: "med spa",

  search: {
    place_types: ["skin_care_clinic"],
    text_queries: [
      "med spa",
      "medical spa botox fillers",
      "laser hair removal clinic",
      "aesthetics clinic injectables",
      "body contouring",
    ],
    require_name_match: true,
    name_keywords: [
      "med spa", "medspa", "medical spa", "medi spa", "medispa",
      "aesthetic*", "laser", "botox", "injector*", "injectable*", "rejuvenation",
      "skin clinic", "cosmetic clinic", "body sculpt*", "contour*",
    ],
    reject_types: [
      "hair_salon", "nail_salon", "barber_shop", "massage", "massage_spa",
      "body_art_service", "amusement_center", "amusement_park", "store",
    ],
  },

  exclude_chains: [
    "Ideal Image", "LaserAway", "Milan Laser Hair Removal", "Milan Laser", "SkinSpirit",
    "Ever/Body", "Alchemy 43", "Hand & Stone", "European Wax Center", "Woodhouse Spa",
    "Sono Bello", "Skin Laundry", "Heyday", "Massage Envy", "Ulta Beauty",
  ],

  // Booking platforms that bundle payments. Signatures are each vendor's own
  // domain; "blvd.co" carries its slashes so sunsetblvd.com does not match.
  software: {
    Boulevard: ["joinblvd.com", "//blvd.co"],
    Vagaro: ["vagaro.com"],
    Zenoti: ["zenoti.com"],
    Mindbody: ["mindbodyonline.com", "healcode.com"],
    Mangomint: ["mangomint.com"],
    GlossGenius: ["glossgenius.com"],
    "Aesthetic Record": ["aestheticrecord.com"],
  },
  software_chip: "booking software",

  financing: {
    CareCredit: ["carecredit.com"],
    Cherry: ["withcherry.com"],
    PatientFi: ["patientfi.com"],
    Alphaeon: ["alphaeoncredit.com"],
  },
  checkout_keywords: ["book", "appointment", "schedule", "membership", "pay", "financ"],

  high_ticket_keywords: [
    "coolsculpt*", "morpheus8", "emsculpt", "co2 laser", "laser resurfacing",
    "body contouring", "thread lift", "hormone*", "weight loss", "semaglutide",
    "tirzepatide", "membership*", "filler*",
  ],

  scoring_profile: "service",
  volume: 0.9,
  decision_makers: ["Owner", "Practice manager", "Medical director"],

  copy: {
    plural: "med spas",
    ticket_label: "treatment",
    ticket_example: 750,
    customer: "client",
    software_hint: "booking software",
  },
};
