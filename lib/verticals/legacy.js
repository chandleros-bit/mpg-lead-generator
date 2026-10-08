// lib/verticals/legacy.js
// The original broad verticals. They carry search types and a volume weight
// only: no specialty search, no software fingerprints, no custom copy. They
// keep the mixed default search working exactly as it did before packs.

export const LEGACY_PACKS = [
  {
    id: "restaurant", label: "Restaurants", noun: "restaurant", volume: 1.0,
    search: { place_types: ["restaurant", "meal_takeaway", "meal_delivery", "pizza_restaurant", "mexican_restaurant"] },
    decision_makers: ["Owner", "General manager"],
  },
  {
    id: "bar", label: "Bars", noun: "bar", volume: 1.0,
    search: { place_types: ["bar", "pub", "night_club"] },
    decision_makers: ["Owner", "General manager"],
  },
  {
    id: "cafe", label: "Cafes", noun: "cafe", volume: 0.9,
    search: { place_types: ["cafe", "coffee_shop"] },
    decision_makers: ["Owner"],
  },
  {
    id: "retail", label: "Retail", noun: "store", volume: 0.85,
    search: { place_types: ["clothing_store", "shoe_store", "gift_shop", "furniture_store"] },
    decision_makers: ["Owner", "Store manager"],
  },
  {
    id: "salon", label: "Salons", noun: "salon", volume: 0.7,
    search: { place_types: ["hair_salon", "beauty_salon", "nail_salon", "barber_shop"] },
    decision_makers: ["Owner"],
  },
  {
    id: "spa", label: "Spas", noun: "spa", volume: 0.7,
    search: { place_types: ["spa"] },
    decision_makers: ["Owner"],
  },
  {
    id: "auto", label: "Car wash and parts", noun: "business", volume: 0.75,
    search: { place_types: ["car_wash", "auto_parts_store"] },
    decision_makers: ["Owner"],
  },
  {
    id: "professional", label: "Professional services", noun: "practice", volume: 0.6,
    search: { place_types: ["dentist", "doctor", "lawyer", "accounting", "veterinary_care"] },
    decision_makers: ["Owner", "Office manager"],
  },
];
