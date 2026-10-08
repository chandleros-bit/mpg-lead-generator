// lib/verticals/dentist.js
// Independent dental practices. High tickets (implants, ortho, crowns), steady
// volume, and an office manager who usually owns the processing decision.

export default {
  id: "dentist",
  label: "Dentists",
  noun: "dental practice",

  search: {
    place_types: ["dentist", "dental_clinic"],
    text_queries: [
      "dental implants",
      "cosmetic dentist",
      "orthodontist",
      "oral surgeon",
      "periodontist",
      "pediatric dentist",
      "family dentist",
    ],
    name_keywords: [
      "dental", "dentist*", "orthodont*", "endodont*", "periodont*", "prosthodont*",
      "oral surgery", "oral surgeon*", "implant*", "braces", "smile*",
    ],
    reject_types: ["store", "pharmacy", "drugstore", "insurance_agency"],
  },

  exclude_chains: [
    "Aspen Dental", "Western Dental", "Bright Now! Dental", "Monarch Dental",
    "Castle Dental", "Coast Dental", "Kool Smiles", "ClearChoice",
    "ClearChoice Dental Implant Center", "Gentle Dental", "Ideal Dental",
    "Perfect Teeth", "Dental Depot", "Smile Direct Club", "Great Expressions",
    "Affordable Dentures", "Affordable Dentures & Implants", "Sonrava",
  ],

  // Patient communication and payment platforms that sell their own
  // processing. Practice management systems (Dentrix, Open Dental) almost
  // never show on a public site, so they are not worth a signature.
  software: {
    Weave: ["getweave.com"],
    NexHealth: ["nexhealth.com"],
    "Rectangle Health": ["rectanglehealth.com"],
  },
  software_chip: "patient payments platform",

  financing: {
    CareCredit: ["carecredit.com"],
    Cherry: ["withcherry.com"],
    Sunbit: ["sunbit.com"],
    Alphaeon: ["alphaeoncredit.com"],
    "LendingClub Patient Solutions": ["lendingclub.com/patientsolutions"],
  },
  checkout_keywords: ["pay", "financ", "appointment", "schedule", "book"],

  high_ticket_keywords: [
    "implant*", "all-on-4", "full mouth", "invisalign", "orthodont*", "braces",
    "veneer*", "crown*", "sedation", "oral surgery", "cosmetic", "root canal*",
    "dentures",
  ],

  volume: 0.95,
  decision_makers: ["Office manager", "Owner dentist"],

  copy: {
    plural: "dental practices",
    ticket_label: "treatment plan",
    ticket_example: 1500,
    customer: "patient",
    software_hint: "practice software or patient payment app",
  },
};
