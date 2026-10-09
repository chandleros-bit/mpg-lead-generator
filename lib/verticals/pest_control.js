// lib/verticals/pest_control.js
// Local pest control. No Google type, so Text Search only, verified by name.
// Tickets are small but recurring: most revenue is service plans billed to a
// card on file, which makes the effective rate on recurring billing the pitch.

export default {
  id: "pest_control",
  label: "Pest control",
  noun: "pest control company",

  search: {
    place_types: [],
    text_queries: [
      "pest control service",
      "exterminator",
      "termite control",
      "mosquito control service",
      "rodent control",
    ],
    name_keywords: [
      "pest*", "exterminat*", "termite*", "bug*", "mosquito*", "rodent*", "critter*",
      "wildlife",
    ],
    reject_types: [
      "home_improvement_store", "hardware_store", "garden_center", "store",
      "car_dealer", "pet_store", "veterinary_care",
    ],
  },

  exclude_chains: [
    "Terminix", "Orkin", "Rentokil", "Truly Nolen", "Aptive", "Aptive Environmental",
    "Arrow Exterminators", "Mosquito Joe", "Mosquito Squad", "Mosquito Authority",
    "Bulwark Exterminating", "Hawx Pest Control", "Western Exterminator", "Ehrlich",
    "Massey Services", "Cook's Pest Control",
  ],

  software: {
    FieldRoutes: ["fieldroutes.com", "pestroutes.com"],
    PestPac: ["pestpac.com"],
    GorillaDesk: ["gorilladesk.com"],
    Briostack: ["briostack.com"],
    ServSuite: ["servsuite.net"],
    ServiceTitan: ["servicetitan.com"],
  },
  software_chip: "pest control software",

  checkout_keywords: ["pay", "portal", "account", "schedule"],

  high_ticket_keywords: [
    "termite*", "sentricon", "wildlife", "exclusion", "attic insulation",
    "commercial", "annual plan", "service plan", "quarterly",
  ],

  scoring_profile: "service",
  volume: 0.75,
  decision_makers: ["Owner", "Office manager"],

  copy: {
    plural: "pest control companies",
    ticket_label: "annual service plan",
    ticket_example: 600,
    customer: "customer",
    software_hint: "pest control software",
    recurring: true,
  },
};
