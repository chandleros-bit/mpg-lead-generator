import json
from pathlib import Path

from mpg_leads.models import Business, ScoredLead
from mpg_leads.scoring import (
    classify_track, dissatisfaction_points, keyword_pain_points, tech_points,
    volume_points, recency_points, volume_potential_points, setup_gap_points,
    score_business,
)
from mpg_leads.campaigns import generate_campaign
from mpg_leads.fetcher import parse_places_response, dedupe, PRICE_LEVELS, normalize_category
from mpg_leads.pipeline import build_leads, summarize

ICP = {"restaurant", "bar", "cafe", "retail", "salon", "spa", "auto", "professional"}

WEIGHTS = {
    "displacement": {"dissatisfaction_max": 35, "keyword_pain_max": 12,
                     "tech_max": 20, "volume_max": 20, "icp_tiebreak": 3},
    "greenfield": {"recency_max": 40, "volume_potential_max": 30,
                   "setup_gap_max": 27, "icp_tiebreak": 3},
    "buckets": {"hot": 70, "warm": 40},
    "greenfield_review_cutoff": 8,
}

PERSONAL = {
    "name": "Chandler Atkinson", "company": "Media Payments Group",
    "callback_number": "(555) 555-5555", "email": "c@mpg.com",
    "canspam_footer": {"business_address": "1 St, Cypress TX",
                       "optout_line": "Reply STOP to opt out."},
}

CFG = {"search": {"verticals": list(ICP)}, "personal": PERSONAL, "weights": WEIGHTS}


def make_business(**kw):
    defaults = dict(
        place_id="p1", name="Test Co", category="restaurant", address="1 Main St",
        phone=None, website=None, rating=None, review_count=0,
        price_level=None, business_status="OPERATIONAL", review_texts=[],
    )
    defaults.update(kw)
    return Business(**defaults)


# ---------- classification ----------
def test_out_of_icp_is_low_fit():
    assert classify_track(make_business(category="laundromat", review_count=100), ICP, 8) == "low_fit"

def test_few_reviews_is_greenfield():
    assert classify_track(make_business(category="restaurant", review_count=3), ICP, 8) == "greenfield"

def test_established_is_displacement():
    assert classify_track(make_business(category="salon", review_count=210), ICP, 8) == "displacement"

def test_cutoff_is_exclusive():
    assert classify_track(make_business(category="cafe", review_count=8), ICP, 8) == "displacement"


# ---------- displacement scorers ----------
def test_dissatisfaction_scales():
    assert dissatisfaction_points(4.2, 100, 35) == 0
    assert dissatisfaction_points(3.0, 100, 35) == 35
    assert dissatisfaction_points(3.6, 100, 35) == 18
    assert dissatisfaction_points(2.5, 100, 35) == 35

def test_dissatisfaction_needs_volume():
    assert dissatisfaction_points(3.0, 19, 35) == 0
    assert dissatisfaction_points(None, 100, 35) == 0

def test_keyword_pain_caps_and_reports():
    pts, hits = keyword_pain_points(["they add a surcharge", "card declined twice"], 12)
    assert pts == 12 and set(hits) == {"fees", "friction"}
    assert keyword_pain_points(["great food"], 12) == (0, [])

def test_tech_points():
    assert tech_points(None, [], 20) == 18
    assert tech_points(None, ["cash only here"], 20) == 20
    assert tech_points("http://s.com", [], 20) == 0

def test_volume_points():
    assert volume_points(4, 200, 20) == 20
    assert volume_points(0, 0, 20) == 0


# ---------- greenfield scorers ----------
def test_recency():
    assert recency_points(0, 8, 40) == 40
    assert recency_points(4, 8, 40) == 20
    assert recency_points(8, 8, 40) == 0

def test_volume_potential():
    assert volume_potential_points("restaurant", 4, 30) > volume_potential_points("professional", 0, 30)

def test_setup_gap():
    assert setup_gap_points(None, 27) == 27
    assert setup_gap_points("http://x.com", 27) == 8


# ---------- assembly ----------
def test_low_fit_scores_zero():
    lead = score_business(make_business(category="laundromat", review_count=50), WEIGHTS, ICP)
    assert lead.track == "low_fit" and lead.score == 0 and lead.bucket == "cold"

def test_unhappy_salon_is_hot_displacement():
    b = make_business(category="salon", rating=3.2, review_count=210, website=None,
                      price_level=2, review_texts=["cash only and a surcharge"])
    lead = score_business(b, WEIGHTS, ICP)
    assert lead.track == "displacement" and lead.bucket == "hot"
    assert any("Displacement" in w for w in lead.why)

def test_fresh_taqueria_is_hot_greenfield():
    b = make_business(category="restaurant", review_count=2, website=None, price_level=2)
    lead = score_business(b, WEIGHTS, ICP)
    assert lead.track == "greenfield" and lead.score >= 70 and lead.bucket == "hot"

def test_score_clamps_to_100():
    b = make_business(category="restaurant", review_count=0, website=None, price_level=4)
    assert score_business(b, WEIGHTS, ICP).score <= 100


# ---------- campaigns ----------
def displacement_lead():
    b = make_business(name="Cut & Co Salon", category="salon", rating=3.5, review_count=120)
    return ScoredLead(b, "displacement", 75, "hot", ["Displacement • Salon"])

def greenfield_lead():
    b = make_business(name="Nueva Taqueria", category="restaurant", review_count=2)
    return ScoredLead(b, "greenfield", 80, "hot", ["Greenfield • Restaurant"])

def test_displacement_angle_not_setup():
    c = generate_campaign(displacement_lead(), PERSONAL)
    body = (c.email1_body + c.email2_body).lower()
    assert "switch" in body or "overpay" in body or "rate" in body
    assert "getting set up" not in body

def test_greenfield_angle_not_switch():
    c = generate_campaign(greenfield_lead(), PERSONAL)
    body = (c.email1_body + c.email2_body).lower()
    assert "set up" in body or "getting started" in body
    assert "switch" not in body

def test_footer_and_tokens_present():
    c = generate_campaign(displacement_lead(), PERSONAL)
    assert "Reply STOP to opt out." in c.email1_body
    assert "{" not in c.email1_body and "}" not in c.voicemail


# ---------- fetcher ----------
FIXTURE = Path("src/mpg_leads/static/demo_places.json")

def test_parse_and_normalize():
    raw = json.loads(FIXTURE.read_text())
    businesses = parse_places_response(raw)
    assert len(businesses) == 10
    barber = next(b for b in businesses if b.place_id == "DEMO_A")
    assert barber.category == "salon"          # barber_shop → salon
    assert barber.price_level == PRICE_LEVELS["PRICE_LEVEL_MODERATE"]
    assert any("cash only" in t.lower() for t in barber.review_texts)

def test_normalize_category_passthrough():
    assert normalize_category("restaurant") == "restaurant"
    assert normalize_category("unknown_type") == "unknown_type"

def test_dedupe():
    raw = json.loads(FIXTURE.read_text())
    businesses = parse_places_response(raw)
    fresh = dedupe(businesses, {"DEMO_A"})
    assert all(b.place_id != "DEMO_A" for b in fresh)


# ---------- pipeline ----------
def test_build_leads_excludes_low_fit_and_sorts():
    raw = json.loads(FIXTURE.read_text())
    businesses = parse_places_response(raw)
    rows = build_leads(CFG, businesses)
    # DEMO_I is a laundromat (low-fit) → excluded
    assert all(r["name"] != "Cypress Discount Vapes" for r in rows)
    scores = [r["score"] for r in rows]
    assert scores == sorted(scores, reverse=True)
    assert all(r["campaign"]["email1_body"] for r in rows)

def test_summarize_counts():
    raw = json.loads(FIXTURE.read_text())
    rows = build_leads(CFG, parse_places_response(raw))
    s = summarize(rows)
    assert s["total"] == len(rows)
    assert s["displacement"] + s["greenfield"] == s["total"]
