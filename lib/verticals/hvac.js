// lib/verticals/hvac.js
// Residential and light-commercial HVAC. Google has no HVAC type, so this is a
// Text Search only niche: a result counts when its name says HVAC.
// System replacements are some of the biggest card tickets a homeowner runs.

export default {
  id: "hvac",
  label: "HVAC",
  noun: "HVAC company",

  search: {
    place_types: [],
    text_queries: [
      "air conditioning installation",
      "HVAC contractor",
      "heat pump installation",
      "AC repair",
      "heating and air conditioning service",
      "furnace repair",
    ],
    name_keywords: [
      "hvac", "air", "a/c", "ac", "heating", "cooling", "comfort", "climate",
      "refrigeration", "mechanical", "furnace*", "heat pump*",
    ],
    reject_types: [
      "home_improvement_store", "hardware_store", "home_goods_store", "electronics_store",
      "furniture_store", "store", "car_repair", "car_dealer", "gas_station", "airport",
    ],
  },

  exclude_chains: [
    "One Hour Heating & Air Conditioning", "One Hour Heating and Air Conditioning",
    "Aire Serv", "Service Experts", "ARS Rescue Rooter", "Lennox Stores",
    "Ferguson", "Johnstone Supply", "Carrier Enterprise", "Home Depot", "Lowe's",
  ],

  // Field service platforms with embedded payments. ServiceTitan also runs
  // pest control shops; the registry merges the signature lists.
  software: {
    ServiceTitan: ["servicetitan.com"],
    "Housecall Pro": ["housecallpro.com"],
    Jobber: ["getjobber.com"],
    FieldEdge: ["fieldedge.com"],
    "Service Fusion": ["servicefusion.com"],
    Workiz: ["workiz.com"],
  },
  software_chip: "field service software",

  financing: {
    GreenSky: ["greensky.com"],
    "Service Finance": ["svcfin.com"],
    Wisetack: ["wisetack.com"],
    Synchrony: ["mysynchrony.com", "synchrony.com"],
    Hearth: ["gethearth.com"],
    GoodLeap: ["goodleap.com"],
    "Foundation Finance": ["foundationfinance.com"],
  },
  checkout_keywords: ["financ", "schedule", "book", "pay"],

  high_ticket_keywords: [
    "new system", "new unit", "system replacement", "install*",
    "heat pump*", "ductwork", "duct*", "mini split", "furnace replacement",
    "commercial", "maintenance plan", "financing",
  ],

  volume: 0.95,
  decision_makers: ["Owner", "Office manager", "General manager"],

  copy: {
    plural: "HVAC companies",
    ticket_label: "system replacement",
    ticket_example: 9000,
    customer: "homeowner",
    software_hint: "field service software",
  },
};
