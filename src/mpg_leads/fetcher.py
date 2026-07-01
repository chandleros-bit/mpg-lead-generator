import json
import time
from pathlib import Path

import requests

from mpg_leads.models import Business

PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby"
PRICE_LEVELS = {
    "PRICE_LEVEL_FREE": 0, "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2, "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}
FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.primaryType",
    "places.formattedAddress", "places.nationalPhoneNumber",
    "places.websiteUri", "places.rating", "places.userRatingCount",
    "places.priceLevel", "places.businessStatus", "places.reviews",
])

# Google returns granular primary types; map the common ones into our ICP vocab.
TYPE_NORMALIZATION = {
    "hair_salon": "salon", "beauty_salon": "salon", "nail_salon": "salon",
    "barber_shop": "salon", "spa": "spa", "day_spa": "spa",
    "restaurant": "restaurant", "meal_takeaway": "restaurant",
    "meal_delivery": "restaurant", "pizza_restaurant": "restaurant",
    "mexican_restaurant": "restaurant", "cafe": "cafe", "coffee_shop": "cafe",
    "bar": "bar", "pub": "bar", "night_club": "bar",
    "clothing_store": "retail", "store": "retail", "shoe_store": "retail",
    "gift_shop": "retail", "furniture_store": "retail", "boutique": "retail",
    "car_repair": "auto", "car_wash": "auto", "auto_parts_store": "auto",
    "dentist": "professional", "doctor": "professional", "lawyer": "professional",
    "accounting": "professional", "veterinary_care": "professional",
}


def normalize_category(primary_type: str) -> str:
    return TYPE_NORMALIZATION.get(primary_type, primary_type)


def parse_places_response(raw: dict) -> list[Business]:
    out = []
    for p in raw.get("places", []):
        reviews = [r.get("text", {}).get("text", "")
                   for r in p.get("reviews", []) if r.get("text")]
        out.append(Business(
            place_id=p["id"],
            name=p.get("displayName", {}).get("text", ""),
            category=normalize_category(p.get("primaryType", "")),
            address=p.get("formattedAddress", ""),
            phone=p.get("nationalPhoneNumber"),
            website=p.get("websiteUri"),
            rating=p.get("rating"),
            review_count=p.get("userRatingCount", 0),
            price_level=PRICE_LEVELS.get(p.get("priceLevel")),
            business_status=p.get("businessStatus", ""),
            review_texts=[t for t in reviews if t],
        ))
    return out


def dedupe(businesses: list[Business], seen_ids: set[str]) -> list[Business]:
    return [b for b in businesses if b.place_id not in seen_ids]


def load_seen(path: str) -> set[str]:
    p = Path(path)
    if not p.exists():
        return set()
    return set(json.loads(p.read_text()))


def save_seen(path: str, seen_ids: set[str]) -> None:
    Path(path).write_text(json.dumps(sorted(seen_ids)))


def load_demo_businesses() -> list[Business]:
    """Load bundled demo data so the dashboard renders without an API key."""
    fixture = Path(__file__).parent / "static" / "demo_places.json"
    return parse_places_response(json.loads(fixture.read_text()))


def fetch_nearby(api_key, location, radius_meters, included_types,
                 max_results=20, retries=3) -> list[Business]:
    """Call Places Nearby Search. Returns list[Business]. Retries on 429."""
    lat, lng = (float(x) for x in location.split(","))
    body = {
        "includedTypes": included_types,
        "maxResultCount": max_results,
        "locationRestriction": {"circle": {
            "center": {"latitude": lat, "longitude": lng},
            "radius": float(radius_meters)}},
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": FIELD_MASK,
    }
    for attempt in range(retries):
        resp = requests.post(PLACES_URL, headers=headers, json=body, timeout=30)
        if resp.status_code == 429:
            time.sleep(2 ** attempt)
            continue
        resp.raise_for_status()
        return parse_places_response(resp.json())
    raise RuntimeError("Places API rate limit: exhausted retries")
