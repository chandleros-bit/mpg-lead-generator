// lib/verticals/remodeling.js
// Home remodelers: kitchen, bath, whole-house, additions. Google has no Table A
// type for them (general_contractor is Table B), so this is Text Search only,
// verified by name. Tickets are the largest in the registry; volume is lumpy.

export default {
  id: "remodeling",
  label: "Home remodeling",
  noun: "remodeling company",

  search: {
    place_types: [],
    text_queries: [
      "kitchen remodeling contractor",
      "bathroom remodeling contractor",
      "home remodeling contractor",
      "home renovation company",
      "room addition contractor",
      "design build remodeler",
    ],
    name_keywords: [
      "remodel*", "renovat*", "kitchen*", "bath", "bathroom*", "design build",
      "design-build", "home improvement*", "construction", "contracting",
      "contractor*", "builder*",
    ],
    reject_types: [
      "home_improvement_store", "hardware_store", "building_materials_store",
      "furniture_store", "home_goods_store", "store", "real_estate_agency",
      "moving_company", "storage",
    ],
  },

  exclude_chains: [
    "Re-Bath", "Bath Fitter", "Kitchen Tune-Up", "Home Depot", "Lowe's",
    "Floor & Decor", "Renewal by Andersen", "Window World", "Five Star Bath Solutions",
    "DreamMaker Bath & Kitchen", "N-Hance", "Mr. Handyman", "Ace Handyman Services",
    "Handyman Connection", "Power Home Remodeling", "West Shore Home",
  ],

  software: {
    Buildertrend: ["buildertrend.net", "buildertrend.com"],
    JobTread: ["jobtread.com"],
    CoConstruct: ["coconstruct.com"],
  },
  software_chip: "project management software",

  financing: {
    Hearth: ["gethearth.com"],
    Wisetack: ["wisetack.com"],
    GreenSky: ["greensky.com"],
    GoodLeap: ["goodleap.com"],
    "Service Finance": ["svcfin.com"],
  },
  checkout_keywords: ["financ", "pay", "estimate", "consult"],

  high_ticket_keywords: [
    "whole house", "whole home", "addition*", "full remodel", "gut*",
    "custom cabinet*", "cabinet*", "countertop*", "quartz", "granite",
    "outdoor kitchen*", "pergola*", "design build",
  ],

  volume: 0.9,
  decision_makers: ["Owner", "Office manager"],

  copy: {
    plural: "remodelers",
    ticket_label: "project",
    ticket_example: 35000,
    customer: "homeowner",
    software_hint: "project software",
  },
};
