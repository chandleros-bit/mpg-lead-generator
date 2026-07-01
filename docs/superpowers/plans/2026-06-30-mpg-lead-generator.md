# MPG Merchant Services Lead Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Python CLI that fetches Houston-area merchants via the Google Places API, scores them on a two-track (Displacement/Greenfield) model, generates track-aware outreach copy, and exports two CSVs.

**Architecture:** Linear pipeline — `config.yaml` → fetcher (Places API + dedupe) → scoring engine (classify track, score within track, emit "why") → campaign generator (track-aware copy) → CSV export. Pure functions for scoring/campaigns so they test offline; the only network boundary is the fetcher, tested against a saved fixture.

**Tech Stack:** Python 3.12, `pyyaml` (config), `requests` (Places API), `pytest` (tests). Standard-library `csv`, `json`, `dataclasses`.

---

## File Structure

- `src/mpg_leads/__init__.py` — package marker
- `src/mpg_leads/models.py` — `Business`, `ScoredLead`, `Campaign` dataclasses
- `src/mpg_leads/config.py` — load/validate `config.yaml`, read API key from env
- `src/mpg_leads/scoring.py` — ICP gate, track classification, per-track scorers, `score_business()`
- `src/mpg_leads/campaigns.py` — `generate_campaign()` (track-aware)
- `src/mpg_leads/fetcher.py` — Places API calls, pagination, dedupe
- `src/mpg_leads/export.py` — CSV writers
- `src/mpg_leads/cli.py` — pipeline wiring + error handling
- `tests/` — one test module per source module + `tests/fixtures/sample_places_response.json`
- `config.example.yaml`, `requirements.txt`

**Shared types (defined in Task 2, referenced everywhere):**
- `Business(place_id: str, name: str, category: str, address: str, phone: str|None, website: str|None, rating: float|None, review_count: int, price_level: int|None, business_status: str, review_texts: list[str])`
- `ScoredLead(business: Business, track: str, score: int, bucket: str, why: list[str])` — `track` ∈ {"displacement","greenfield","low_fit"}, `bucket` ∈ {"hot","warm","cold"}
- `Campaign(place_id: str, email1_subject: str, email1_body: str, email2_subject: str, email2_body: str, sms: str, voicemail: str)`

---

## Task 1: Project scaffolding

**Files:**
- Create: `requirements.txt`
- Create: `src/mpg_leads/__init__.py`
- Create: `tests/__init__.py`
- Create: `config.example.yaml`
- Create: `pytest.ini`

- [ ] **Step 1: Create `requirements.txt`**

```
pyyaml==6.0.2
requests==2.32.3
pytest==8.3.3
```

- [ ] **Step 2: Create package markers**

Create `src/mpg_leads/__init__.py` (empty) and `tests/__init__.py` (empty).

- [ ] **Step 3: Create `pytest.ini` so tests find the package**

```ini
[pytest]
pythonpath = src
testpaths = tests
```

- [ ] **Step 4: Create `config.example.yaml`**

```yaml
search:
  location: "29.9691,-95.6972"   # Cypress, TX (lat,long)
  radius_meters: 15000
  verticals: [restaurant, bar, cafe, retail, salon, spa, auto, professional]
  batch_size: 60
  score_threshold: 40            # min score for campaign generation

personal:
  name: "Chandler Atkinson"
  company: "Media Payments Group"
  callback_number: "(555) 555-5555"
  email: "you@example.com"
  canspam_footer:
    business_address: "123 Example St, Cypress, TX 77433"
    optout_line: "Reply STOP or email you@example.com to opt out of further messages."

weights:
  displacement: {dissatisfaction_max: 35, keyword_pain_max: 12, tech_max: 20, volume_max: 20, icp_tiebreak: 3}
  greenfield:   {recency_max: 40, volume_potential_max: 30, setup_gap_max: 27, icp_tiebreak: 3}
  buckets:      {hot: 70, warm: 40}
  greenfield_review_cutoff: 8    # < this many reviews ⇒ Greenfield track
```

- [ ] **Step 5: Install deps and commit**

```bash
pip install -r requirements.txt --break-system-packages
git add requirements.txt src/mpg_leads/__init__.py tests/__init__.py pytest.ini config.example.yaml
git commit -m "chore: project scaffolding"
```

---

## Task 2: Data models

**Files:**
- Create: `src/mpg_leads/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_models.py
from mpg_leads.models import Business, ScoredLead, Campaign


def make_business(**kw):
    defaults = dict(
        place_id="p1", name="Test Co", category="restaurant", address="1 Main St",
        phone=None, website=None, rating=None, review_count=0,
        price_level=None, business_status="OPERATIONAL", review_texts=[],
    )
    defaults.update(kw)
    return Business(**defaults)


def test_business_holds_fields():
    b = make_business(rating=3.8, review_count=210)
    assert b.rating == 3.8 and b.review_count == 210


def test_scored_lead_and_campaign_construct():
    b = make_business()
    lead = ScoredLead(business=b, track="displacement", score=72, bucket="hot", why=["x"])
    camp = Campaign(place_id="p1", email1_subject="s", email1_body="b",
                    email2_subject="s2", email2_body="b2", sms="m", voicemail="v")
    assert lead.bucket == "hot" and camp.place_id == "p1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mpg_leads.models'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/mpg_leads/models.py
from dataclasses import dataclass, field


@dataclass
class Business:
    place_id: str
    name: str
    category: str
    address: str
    phone: str | None
    website: str | None
    rating: float | None
    review_count: int
    price_level: int | None
    business_status: str
    review_texts: list[str] = field(default_factory=list)


@dataclass
class ScoredLead:
    business: Business
    track: str      # "displacement" | "greenfield" | "low_fit"
    score: int
    bucket: str     # "hot" | "warm" | "cold"
    why: list[str] = field(default_factory=list)


@dataclass
class Campaign:
    place_id: str
    email1_subject: str
    email1_body: str
    email2_subject: str
    email2_body: str
    sms: str
    voicemail: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/models.py tests/test_models.py
git commit -m "feat: data models for Business, ScoredLead, Campaign"
```

---

## Task 3: Config loader

**Files:**
- Create: `src/mpg_leads/config.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_config.py
import pytest
from mpg_leads.config import load_config, ConfigError

VALID = """
search:
  location: "29.9,-95.6"
  radius_meters: 1000
  verticals: [restaurant]
  batch_size: 10
  score_threshold: 40
personal:
  name: "C A"
  company: "MPG"
  callback_number: "(555) 555-5555"
  email: "a@b.com"
  canspam_footer:
    business_address: "1 St"
    optout_line: "Reply STOP"
weights:
  displacement: {dissatisfaction_max: 35, keyword_pain_max: 12, tech_max: 20, volume_max: 20, icp_tiebreak: 3}
  greenfield:   {recency_max: 40, volume_potential_max: 30, setup_gap_max: 27, icp_tiebreak: 3}
  buckets:      {hot: 70, warm: 40}
  greenfield_review_cutoff: 8
"""


def write(tmp_path, text):
    p = tmp_path / "config.yaml"
    p.write_text(text)
    return str(p)


def test_loads_valid_config_and_reads_key_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "KEY123")
    cfg = load_config(write(tmp_path, VALID))
    assert cfg.api_key == "KEY123"
    assert cfg.search["verticals"] == ["restaurant"]
    assert cfg.weights["buckets"]["hot"] == 70


def test_missing_api_key_raises(tmp_path, monkeypatch):
    monkeypatch.delenv("GOOGLE_PLACES_API_KEY", raising=False)
    with pytest.raises(ConfigError, match="GOOGLE_PLACES_API_KEY"):
        load_config(write(tmp_path, VALID))


def test_missing_required_section_raises(tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "KEY123")
    with pytest.raises(ConfigError, match="search"):
        load_config(write(tmp_path, "personal: {}\n"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mpg_leads.config'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/mpg_leads/config.py
import os
from dataclasses import dataclass

import yaml

API_KEY_ENV = "GOOGLE_PLACES_API_KEY"
REQUIRED_SECTIONS = ("search", "personal", "weights")


class ConfigError(Exception):
    pass


@dataclass
class Config:
    search: dict
    personal: dict
    weights: dict
    api_key: str


def load_config(path: str) -> Config:
    try:
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
    except FileNotFoundError as e:
        raise ConfigError(f"Config file not found: {path}") from e

    for section in REQUIRED_SECTIONS:
        if section not in raw:
            raise ConfigError(f"Missing required config section: '{section}'")

    api_key = os.environ.get(API_KEY_ENV)
    if not api_key:
        raise ConfigError(
            f"{API_KEY_ENV} environment variable is not set. "
            f"Export your Google Places API key before running."
        )

    return Config(
        search=raw["search"],
        personal=raw["personal"],
        weights=raw["weights"],
        api_key=api_key,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_config.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/config.py tests/test_config.py
git commit -m "feat: config loader with env-based API key"
```

---

## Task 4: Scoring — ICP gate & track classification

**Files:**
- Create: `src/mpg_leads/scoring.py`
- Test: `tests/test_scoring.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_scoring.py
from mpg_leads.scoring import classify_track
from tests.test_models import make_business

ICP = {"restaurant", "bar", "cafe", "retail", "salon", "spa", "auto", "professional"}


def test_out_of_icp_is_low_fit():
    b = make_business(category="laundromat", review_count=100)
    assert classify_track(b, icp=ICP, greenfield_cutoff=8) == "low_fit"


def test_few_reviews_in_icp_is_greenfield():
    b = make_business(category="restaurant", review_count=3)
    assert classify_track(b, icp=ICP, greenfield_cutoff=8) == "greenfield"


def test_established_in_icp_is_displacement():
    b = make_business(category="salon", review_count=210)
    assert classify_track(b, icp=ICP, greenfield_cutoff=8) == "displacement"


def test_cutoff_is_exclusive_boundary():
    # exactly at cutoff ⇒ displacement (>= cutoff)
    b = make_business(category="cafe", review_count=8)
    assert classify_track(b, icp=ICP, greenfield_cutoff=8) == "displacement"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_scoring.py -v`
Expected: FAIL with `ImportError: cannot import name 'classify_track'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/mpg_leads/scoring.py
from mpg_leads.models import Business


def classify_track(b: Business, icp: set[str], greenfield_cutoff: int) -> str:
    if b.category not in icp:
        return "low_fit"
    if b.review_count < greenfield_cutoff:
        return "greenfield"
    return "displacement"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_scoring.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/scoring.py tests/test_scoring.py
git commit -m "feat: ICP gate and track classification"
```

---

## Task 5: Scoring — Displacement scorers

**Files:**
- Modify: `src/mpg_leads/scoring.py`
- Test: `tests/test_scoring.py`

- [ ] **Step 1: Write the failing tests (append to `tests/test_scoring.py`)**

```python
from mpg_leads.scoring import (
    dissatisfaction_points, keyword_pain_points, tech_points, volume_points,
)


def test_dissatisfaction_scales_with_low_rating():
    assert dissatisfaction_points(4.2, 100, 35) == 0        # happy
    assert dissatisfaction_points(3.0, 100, 35) == 35       # very unhappy
    assert dissatisfaction_points(3.6, 100, 35) == 18       # midpoint ~half
    assert dissatisfaction_points(2.5, 100, 35) == 35       # below floor clamps to max


def test_dissatisfaction_requires_review_volume():
    assert dissatisfaction_points(3.0, 19, 35) == 0         # not enough reviews
    assert dissatisfaction_points(None, 100, 35) == 0       # no rating


def test_keyword_pain_caps_and_reports_groups():
    pts, hits = keyword_pain_points(["they add a surcharge", "card declined twice"], 12)
    assert pts == 12 and set(hits) == {"fees", "friction"}
    pts2, hits2 = keyword_pain_points(["great food"], 12)
    assert pts2 == 0 and hits2 == []


def test_tech_points_no_website_and_cash_only():
    assert tech_points(None, [], 20) == 18
    assert tech_points(None, ["cash only here"], 20) == 20   # 18 + 2
    assert tech_points("http://site.com", [], 20) == 0


def test_volume_points_combines_price_and_reviews():
    assert volume_points(4, 200, 20) == 20                   # max price + max reviews
    assert volume_points(0, 0, 20) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_scoring.py -v`
Expected: FAIL with `ImportError: cannot import name 'dissatisfaction_points'`

- [ ] **Step 3: Write minimal implementation (append to `src/mpg_leads/scoring.py`)**

```python
FEE_KEYWORDS = ["surcharge", "cash only", "card fee", "adds 3", "card minimum",
                "convenience fee", "fee to use card", "extra to use card"]
FRICTION_KEYWORDS = ["card declined", "machine down", "card reader", "terminal",
                     "system was down", "couldn't take card", "card wasn't working"]


def dissatisfaction_points(rating, review_count, wmax):
    if rating is None or review_count < 20 or rating > 4.2:
        return 0
    r = max(rating, 3.0)
    frac = (4.2 - r) / (4.2 - 3.0)   # 0 at 4.2, 1 at 3.0
    return round(frac * wmax)


def keyword_pain_points(review_texts, wmax):
    text = " ".join(review_texts).lower()
    groups = {"fees": FEE_KEYWORDS, "friction": FRICTION_KEYWORDS}
    hits = [g for g, kws in groups.items() if any(kw in text for kw in kws)]
    return min(wmax, len(hits) * 6), hits


def tech_points(website, review_texts, wmax):
    text = " ".join(review_texts).lower()
    pts = 0
    if not website:
        pts += 18
    if "cash only" in text:
        pts += 2
    return min(pts, wmax)


def volume_points(price_level, review_count, wmax):
    pl = price_level if price_level is not None else 1
    price_pts = pl / 4 * 10
    rc_pts = min(review_count / 200, 1.0) * 10
    return round(min(price_pts + rc_pts, wmax))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_scoring.py -v`
Expected: PASS (all displacement scorer tests)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/scoring.py tests/test_scoring.py
git commit -m "feat: displacement-track scoring functions"
```

---

## Task 6: Scoring — Greenfield scorers

**Files:**
- Modify: `src/mpg_leads/scoring.py`
- Test: `tests/test_scoring.py`

- [ ] **Step 1: Write the failing tests (append to `tests/test_scoring.py`)**

```python
from mpg_leads.scoring import (
    recency_points, volume_potential_points, setup_gap_points,
)


def test_recency_higher_for_fewer_reviews():
    assert recency_points(0, 8, 40) == 40
    assert recency_points(4, 8, 40) == 20
    assert recency_points(8, 8, 40) == 0     # at cutoff, no recency credit


def test_volume_potential_uses_vertical_and_price():
    hi = volume_potential_points("restaurant", 4, 30)
    lo = volume_potential_points("professional", 0, 30)
    assert hi > lo and hi <= 30 and lo >= 0


def test_setup_gap_rewards_no_website():
    assert setup_gap_points(None, 27) == 27
    assert setup_gap_points("http://x.com", 27) == 8   # round(27*0.3)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_scoring.py -v`
Expected: FAIL with `ImportError: cannot import name 'recency_points'`

- [ ] **Step 3: Write minimal implementation (append to `src/mpg_leads/scoring.py`)**

```python
VERTICAL_VOLUME = {
    "restaurant": 1.0, "bar": 1.0, "cafe": 0.9, "retail": 0.85,
    "auto": 0.75, "salon": 0.7, "spa": 0.7, "professional": 0.6,
}


def recency_points(review_count, greenfield_cutoff, wmax):
    if review_count >= greenfield_cutoff:
        return 0
    return round((greenfield_cutoff - review_count) / greenfield_cutoff * wmax)


def volume_potential_points(vertical, price_level, wmax):
    base = VERTICAL_VOLUME.get(vertical, 0.6)
    pl = (price_level if price_level is not None else 1) / 4
    return round((0.6 * base + 0.4 * pl) * wmax)


def setup_gap_points(website, wmax):
    return wmax if not website else round(wmax * 0.3)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_scoring.py -v`
Expected: PASS (all greenfield scorer tests)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/scoring.py tests/test_scoring.py
git commit -m "feat: greenfield-track scoring functions"
```

---

## Task 7: Scoring — assemble `score_business()` with bucket + why array

**Files:**
- Modify: `src/mpg_leads/scoring.py`
- Test: `tests/test_scoring.py`

- [ ] **Step 1: Write the failing tests (append to `tests/test_scoring.py`)**

```python
from mpg_leads.scoring import score_business

WEIGHTS = {
    "displacement": {"dissatisfaction_max": 35, "keyword_pain_max": 12,
                     "tech_max": 20, "volume_max": 20, "icp_tiebreak": 3},
    "greenfield": {"recency_max": 40, "volume_potential_max": 30,
                   "setup_gap_max": 27, "icp_tiebreak": 3},
    "buckets": {"hot": 70, "warm": 40},
    "greenfield_review_cutoff": 8,
}


def test_low_fit_scores_zero_and_cold():
    b = make_business(category="laundromat", review_count=50)
    lead = score_business(b, WEIGHTS, icp=ICP)
    assert lead.track == "low_fit" and lead.score == 0 and lead.bucket == "cold"


def test_unhappy_established_salon_is_hot_displacement():
    b = make_business(category="salon", rating=3.2, review_count=210,
                      website=None, price_level=2,
                      review_texts=["they are cash only and added a surcharge"])
    lead = score_business(b, WEIGHTS, icp=ICP)
    assert lead.track == "displacement"
    assert lead.bucket == "hot"
    assert any("Displacement" in w for w in lead.why)
    assert any("cash only" in w.lower() or "surcharge" in w.lower() for w in lead.why)


def test_fresh_taqueria_is_greenfield_and_scored():
    b = make_business(category="restaurant", rating=None, review_count=2,
                      website=None, price_level=2)
    lead = score_business(b, WEIGHTS, icp=ICP)
    assert lead.track == "greenfield"
    assert lead.score >= 70 and lead.bucket == "hot"
    assert any("Greenfield" in w for w in lead.why)


def test_score_clamps_to_100():
    b = make_business(category="restaurant", review_count=0, website=None, price_level=4)
    lead = score_business(b, WEIGHTS, icp=ICP)
    assert lead.score <= 100
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_scoring.py -v`
Expected: FAIL with `ImportError: cannot import name 'score_business'`

- [ ] **Step 3: Write minimal implementation (append to `src/mpg_leads/scoring.py`)**

```python
def _bucket(score, buckets):
    if score >= buckets["hot"]:
        return "hot"
    if score >= buckets["warm"]:
        return "warm"
    return "cold"


def _label(category):
    return category.capitalize()


def score_business(b: Business, weights: dict, icp: set[str]):
    from mpg_leads.models import ScoredLead

    cutoff = weights["greenfield_review_cutoff"]
    track = classify_track(b, icp=icp, greenfield_cutoff=cutoff)
    why: list[str] = []

    if track == "low_fit":
        return ScoredLead(business=b, track=track, score=0, bucket="cold",
                          why=[f"Low-fit • {_label(b.category)} • outside target verticals"])

    if track == "displacement":
        w = weights["displacement"]
        dis = dissatisfaction_points(b.rating, b.review_count, w["dissatisfaction_max"])
        pain, hits = keyword_pain_points(b.review_texts, w["keyword_pain_max"])
        tech = tech_points(b.website, b.review_texts, w["tech_max"])
        vol = volume_points(b.price_level, b.review_count, w["volume_max"])
        score = dis + pain + tech + vol + w["icp_tiebreak"]

        why.append(f"Displacement • {_label(b.category)}")
        if b.rating is not None and b.review_count >= 20:
            why.append(f"rating {b.rating} on {b.review_count} reviews")
        if "fees" in hits:
            why.append('fee complaints in reviews ("surcharge"/"cash only")')
        if "friction" in hits:
            why.append("payment-friction complaints in reviews")
        if not b.website:
            why.append("no website")
    else:  # greenfield
        w = weights["greenfield"]
        rec = recency_points(b.review_count, cutoff, w["recency_max"])
        volp = volume_potential_points(b.category, b.price_level, w["volume_potential_max"])
        gap = setup_gap_points(b.website, w["setup_gap_max"])
        score = rec + volp + gap + w["icp_tiebreak"]

        why.append(f"Greenfield • {_label(b.category)}")
        why.append(f"{b.review_count} reviews (new, likely no processor yet)")
        if not b.website:
            why.append("no website — needs full setup")

    score = max(0, min(100, round(score)))
    return ScoredLead(business=b, track=track, score=score,
                      bucket=_bucket(score, weights["buckets"]), why=why)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_scoring.py -v`
Expected: PASS (all scoring tests, ~15)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/scoring.py tests/test_scoring.py
git commit -m "feat: assemble score_business with buckets and why array"
```

---

## Task 8: Campaign generator (track-aware)

**Files:**
- Create: `src/mpg_leads/campaigns.py`
- Test: `tests/test_campaigns.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_campaigns.py
from mpg_leads.campaigns import generate_campaign
from mpg_leads.models import ScoredLead
from tests.test_models import make_business

PERSONAL = {
    "name": "Chandler Atkinson", "company": "Media Payments Group",
    "callback_number": "(555) 555-5555", "email": "c@mpg.com",
    "canspam_footer": {"business_address": "1 St, Cypress TX",
                       "optout_line": "Reply STOP to opt out."},
}


def displacement_lead():
    b = make_business(name="Cut & Co Salon", category="salon", rating=3.5, review_count=120)
    return ScoredLead(business=b, track="displacement", score=75, bucket="hot",
                      why=["Displacement • Salon", "rating 3.5 on 120 reviews"])


def greenfield_lead():
    b = make_business(name="Nueva Taqueria", category="restaurant", review_count=2)
    return ScoredLead(business=b, track="greenfield", score=80, bucket="hot",
                      why=["Greenfield • Restaurant", "2 reviews"])


def test_displacement_uses_switch_angle_not_setup():
    c = generate_campaign(displacement_lead(), PERSONAL)
    body = (c.email1_body + c.email2_body).lower()
    assert "cut & co salon" in c.email1_body.lower()
    assert "switch" in body or "overpay" in body or "rate" in body
    assert "getting set up" not in body   # greenfield-only phrasing must not appear


def test_greenfield_uses_setup_angle_not_switch():
    c = generate_campaign(greenfield_lead(), PERSONAL)
    body = (c.email1_body + c.email2_body).lower()
    assert "nueva taqueria" in c.email1_body.lower()
    assert "set up" in body or "getting started" in body or "new" in body
    assert "switch" not in body           # must not tell them to switch


def test_all_touch_fields_and_footer_present():
    c = generate_campaign(displacement_lead(), PERSONAL)
    for field in (c.email1_subject, c.email1_body, c.email2_subject,
                  c.email2_body, c.sms, c.voicemail):
        assert field.strip()
    assert "Reply STOP to opt out." in c.email1_body
    assert "1 St, Cypress TX" in c.email1_body
    assert "(555) 555-5555" in c.voicemail


def test_no_unfilled_tokens_remain():
    c = generate_campaign(greenfield_lead(), PERSONAL)
    joined = "".join([c.email1_subject, c.email1_body, c.email2_subject,
                      c.email2_body, c.sms, c.voicemail])
    assert "{" not in joined and "}" not in joined
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_campaigns.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mpg_leads.campaigns'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/mpg_leads/campaigns.py
from mpg_leads.models import Campaign, ScoredLead


def _footer(personal):
    f = personal["canspam_footer"]
    return f"\n\n—\n{personal['name']}, {personal['company']}\n" \
           f"{f['business_address']}\n{f['optout_line']}"


def _displacement(lead, personal):
    name = lead.business.name
    vertical = lead.business.category
    footer = _footer(personal)
    who = personal["name"]
    company = personal["company"]

    email1_subject = f"Quick question about card processing at {name}"
    email1_body = (
        f"Hi {name} team,\n\n"
        f"I work with {vertical} businesses around Houston on their card "
        f"processing, and a couple of your reviews caught my eye. Would you be "
        f"open to a two-minute look at your current effective rate? Most "
        f"{vertical}s I review are overpaying and don't realize it — no "
        f"long-term contract on our side either.\n\n"
        f"Worth a quick look?\n\n{who}, {company}"
        f"{footer}"
    )
    email2_subject = f"Re: card processing at {name}"
    email2_body = (
        f"Hi again,\n\n"
        f"One concrete thing: if you're on flat-rate pricing (Square, Clover, "
        f"and similar), switching to interchange-plus usually drops the "
        f"effective rate noticeably at your volume. I'm happy to read your "
        f"latest statement and tell you straight whether it's worth changing.\n\n"
        f"Reply here or call/text {personal['callback_number']}.\n\n{who}"
        f"{footer}"
    )
    sms = (
        f"Hi {name} — {who} with {company}. Saw your spot and think you may be "
        f"overpaying on card fees. Open to a quick rate check? No contract."
    )
    voicemail = (
        f"Hi, this is {who} with {company}. I help local {vertical}s cut their "
        f"card-processing costs without locking into a contract. If you'd like a "
        f"free rate review, call me back at {personal['callback_number']}. Thanks!"
    )
    return Campaign(lead.business.place_id, email1_subject, email1_body,
                    email2_subject, email2_body, sms, voicemail)


def _greenfield(lead, personal):
    name = lead.business.name
    vertical = lead.business.category
    footer = _footer(personal)
    who = personal["name"]
    company = personal["company"]

    email1_subject = f"Congrats on {name} — payments set up right"
    email1_body = (
        f"Hi {name} team,\n\n"
        f"Congrats on the new {vertical}! When you're getting set up to take "
        f"cards, the choices you make now are hard to undo later. I help new "
        f"Houston businesses start on transparent pricing and the right hardware "
        f"from day one.\n\n"
        f"Want a quick rundown of what to look for?\n\n{who}, {company}"
        f"{footer}"
    )
    email2_subject = f"Re: getting {name} ready to take cards"
    email2_body = (
        f"Hi again,\n\n"
        f"Quick tip for a new {vertical}: avoid leased terminals and flat-rate "
        f"lock-ins — they're easy to sign up for and expensive to leave. I can "
        f"walk you through getting started on interchange-plus with EMV/NFC "
        f"hardware so you're ready for chip and tap on opening day.\n\n"
        f"Reply here or call/text {personal['callback_number']}.\n\n{who}"
        f"{footer}"
    )
    sms = (
        f"Hi {name} — {who} with {company}. Congrats on opening! Happy to help "
        f"you get card payments set up right from the start. Want a quick tip sheet?"
    )
    voicemail = (
        f"Hi, this is {who} with {company}. Congratulations on the new {vertical}! "
        f"I help new businesses get payments set up right the first time. Give me "
        f"a call back at {personal['callback_number']} whenever's good. Thanks!"
    )
    return Campaign(lead.business.place_id, email1_subject, email1_body,
                    email2_subject, email2_body, sms, voicemail)


def generate_campaign(lead: ScoredLead, personal: dict) -> Campaign:
    if lead.track == "greenfield":
        return _greenfield(lead, personal)
    return _displacement(lead, personal)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_campaigns.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/campaigns.py tests/test_campaigns.py
git commit -m "feat: track-aware campaign generator"
```

---

## Task 9: Fetcher (Places API + pagination + dedupe)

**Files:**
- Create: `src/mpg_leads/fetcher.py`
- Create: `tests/fixtures/sample_places_response.json`
- Test: `tests/test_fetcher.py`

- [ ] **Step 1: Create the fixture `tests/fixtures/sample_places_response.json`**

This is a trimmed Places API "Nearby Search (New)" style response with two places.

```json
{
  "places": [
    {
      "id": "PLACE_A",
      "displayName": {"text": "Cut & Co Salon"},
      "primaryType": "hair_salon",
      "formattedAddress": "100 Barber Ln, Cypress, TX",
      "nationalPhoneNumber": "(281) 555-0100",
      "websiteUri": null,
      "rating": 3.5,
      "userRatingCount": 120,
      "priceLevel": "PRICE_LEVEL_MODERATE",
      "businessStatus": "OPERATIONAL",
      "reviews": [
        {"text": {"text": "They are cash only which is annoying"}},
        {"text": {"text": "Nice cut but the card reader was down"}}
      ]
    },
    {
      "id": "PLACE_B",
      "displayName": {"text": "Nueva Taqueria"},
      "primaryType": "restaurant",
      "formattedAddress": "200 Taco Rd, Cypress, TX",
      "nationalPhoneNumber": "(281) 555-0200",
      "websiteUri": "http://nuevataqueria.com",
      "rating": null,
      "userRatingCount": 2,
      "priceLevel": "PRICE_LEVEL_INEXPENSIVE",
      "businessStatus": "OPERATIONAL",
      "reviews": []
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_fetcher.py
import json
from pathlib import Path

from mpg_leads.fetcher import parse_places_response, dedupe, PRICE_LEVELS

FIXTURE = Path(__file__).parent / "fixtures" / "sample_places_response.json"


def test_parse_maps_places_to_businesses():
    raw = json.loads(FIXTURE.read_text())
    businesses = parse_places_response(raw)
    assert len(businesses) == 2
    a = businesses[0]
    assert a.place_id == "PLACE_A"
    assert a.name == "Cut & Co Salon"
    assert a.website is None
    assert a.rating == 3.5 and a.review_count == 120
    assert a.price_level == PRICE_LEVELS["PRICE_LEVEL_MODERATE"]
    assert any("cash only" in t.lower() for t in a.review_texts)


def test_missing_optional_fields_default_safely():
    raw = {"places": [{"id": "X", "displayName": {"text": "Bare Co"},
                       "primaryType": "restaurant", "formattedAddress": "1 St"}]}
    b = parse_places_response(raw)[0]
    assert b.phone is None and b.rating is None and b.review_count == 0
    assert b.price_level is None and b.review_texts == []


def test_dedupe_filters_seen_ids():
    raw = json.loads(FIXTURE.read_text())
    businesses = parse_places_response(raw)
    fresh = dedupe(businesses, seen_ids={"PLACE_A"})
    assert [b.place_id for b in fresh] == ["PLACE_B"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_fetcher.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mpg_leads.fetcher'`

- [ ] **Step 4: Write minimal implementation**

```python
# src/mpg_leads/fetcher.py
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


def parse_places_response(raw: dict) -> list[Business]:
    out = []
    for p in raw.get("places", []):
        reviews = [r.get("text", {}).get("text", "")
                   for r in p.get("reviews", []) if r.get("text")]
        out.append(Business(
            place_id=p["id"],
            name=p.get("displayName", {}).get("text", ""),
            category=p.get("primaryType", ""),
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


def fetch_nearby(api_key, location, radius_meters, included_types,
                 max_results=20, retries=3):
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_fetcher.py -v`
Expected: PASS (3 tests). Note: `fetch_nearby` is not unit-tested against the network — it's exercised only by the end-to-end smoke test in Task 12.

- [ ] **Step 6: Commit**

```bash
git add src/mpg_leads/fetcher.py tests/test_fetcher.py tests/fixtures/sample_places_response.json
git commit -m "feat: Places API fetcher with parsing and dedupe"
```

---

## Task 10: CSV export

**Files:**
- Create: `src/mpg_leads/export.py`
- Test: `tests/test_export.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_export.py
import csv
from pathlib import Path

from mpg_leads.export import write_leads_csv, write_campaigns_csv
from mpg_leads.models import ScoredLead, Campaign
from tests.test_models import make_business


def a_lead(score=75, track="displacement"):
    b = make_business(name="Cut & Co", category="salon", rating=3.5,
                      review_count=120, phone="(281) 555-0100")
    return ScoredLead(business=b, track=track, score=score, bucket="hot",
                      why=["Displacement • Salon", "rating 3.5 on 120 reviews"])


def a_campaign():
    return Campaign("p1", "s1", "b1", "s2", "b2", "sms", "vm")


def test_leads_csv_sorted_best_first(tmp_path):
    leads = [a_lead(score=50), a_lead(score=90), a_lead(score=70)]
    out = tmp_path / "leads.csv"
    write_leads_csv(str(out), leads)
    rows = list(csv.DictReader(out.open()))
    assert [int(r["score"]) for r in rows] == [90, 70, 50]
    assert rows[0]["name"] == "Cut & Co"
    assert "Displacement" in rows[0]["why"]


def test_campaigns_csv_has_all_copy_columns(tmp_path):
    out = tmp_path / "camp.csv"
    write_campaigns_csv(str(out), [a_campaign()])
    rows = list(csv.DictReader(out.open()))
    assert set(rows[0]) >= {"place_id", "email1_subject", "email1_body",
                            "email2_subject", "email2_body", "sms", "voicemail"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_export.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mpg_leads.export'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/mpg_leads/export.py
import csv

from mpg_leads.models import Campaign, ScoredLead

LEAD_COLUMNS = ["score", "bucket", "track", "name", "category", "rating",
                "review_count", "phone", "website", "address", "why"]
CAMPAIGN_COLUMNS = ["place_id", "email1_subject", "email1_body",
                    "email2_subject", "email2_body", "sms", "voicemail"]


def write_leads_csv(path: str, leads: list[ScoredLead]) -> None:
    ordered = sorted(leads, key=lambda l: l.score, reverse=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LEAD_COLUMNS)
        w.writeheader()
        for l in ordered:
            b = l.business
            w.writerow({
                "score": l.score, "bucket": l.bucket, "track": l.track,
                "name": b.name, "category": b.category, "rating": b.rating,
                "review_count": b.review_count, "phone": b.phone or "",
                "website": b.website or "", "address": b.address,
                "why": " • ".join(l.why),
            })


def write_campaigns_csv(path: str, campaigns: list[Campaign]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CAMPAIGN_COLUMNS)
        w.writeheader()
        for c in campaigns:
            w.writerow({
                "place_id": c.place_id, "email1_subject": c.email1_subject,
                "email1_body": c.email1_body, "email2_subject": c.email2_subject,
                "email2_body": c.email2_body, "sms": c.sms, "voicemail": c.voicemail,
            })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_export.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mpg_leads/export.py tests/test_export.py
git commit -m "feat: CSV export for leads and campaigns"
```

---

## Task 11: CLI pipeline wiring + error handling

**Files:**
- Create: `src/mpg_leads/cli.py`
- Test: `tests/test_cli.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py
import json
from pathlib import Path

from mpg_leads.cli import run_pipeline
from tests.test_fetcher import FIXTURE
from mpg_leads.fetcher import parse_places_response

CFG = {
    "search": {"location": "29.9,-95.6", "radius_meters": 1000,
               "verticals": ["restaurant", "salon"], "batch_size": 20,
               "score_threshold": 40},
    "personal": {"name": "C A", "company": "MPG",
                 "callback_number": "(555) 555-5555", "email": "c@mpg.com",
                 "canspam_footer": {"business_address": "1 St",
                                    "optout_line": "Reply STOP"}},
    "weights": {
        "displacement": {"dissatisfaction_max": 35, "keyword_pain_max": 12,
                         "tech_max": 20, "volume_max": 20, "icp_tiebreak": 3},
        "greenfield": {"recency_max": 40, "volume_potential_max": 30,
                       "setup_gap_max": 27, "icp_tiebreak": 3},
        "buckets": {"hot": 70, "warm": 40}, "greenfield_review_cutoff": 8},
}

# The salon fixture has primaryType "hair_salon"; map it into ICP for the test.
ICP_MAP = {"hair_salon": "salon", "restaurant": "restaurant"}


def fake_fetch(**kwargs):
    raw = json.loads(FIXTURE.read_text())
    businesses = parse_places_response(raw)
    for b in businesses:                       # normalize category to our ICP vocab
        b.category = ICP_MAP.get(b.category, b.category)
    return businesses


def test_run_pipeline_writes_both_csvs(tmp_path, monkeypatch):
    seen = tmp_path / "seen.json"
    leads_out = tmp_path / "leads.csv"
    camp_out = tmp_path / "camp.csv"
    n = run_pipeline(CFG, api_key="KEY", fetch_fn=fake_fetch,
                     seen_path=str(seen), leads_path=str(leads_out),
                     campaigns_path=str(camp_out))
    assert leads_out.exists() and camp_out.exists()
    assert n == 2
    assert seen.exists() and len(json.loads(seen.read_text())) == 2


def test_second_run_dedupes_and_writes_no_new(tmp_path):
    seen = tmp_path / "seen.json"
    seen.write_text(json.dumps(["PLACE_A", "PLACE_B"]))
    n = run_pipeline(CFG, api_key="KEY", fetch_fn=fake_fetch,
                     seen_path=str(seen),
                     leads_path=str(tmp_path / "l.csv"),
                     campaigns_path=str(tmp_path / "c.csv"))
    assert n == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mpg_leads.cli'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/mpg_leads/cli.py
import argparse
import sys
from datetime import date

from mpg_leads.campaigns import generate_campaign
from mpg_leads.config import ConfigError, load_config
from mpg_leads.export import write_campaigns_csv, write_leads_csv
from mpg_leads.fetcher import fetch_nearby, dedupe, load_seen, save_seen
from mpg_leads.scoring import score_business


def run_pipeline(cfg, api_key, fetch_fn, seen_path, leads_path, campaigns_path):
    """Wire fetch → dedupe → score → generate → export. Returns count of new leads."""
    search = cfg["search"]
    icp = set(search["verticals"])
    seen = load_seen(seen_path)

    businesses = fetch_fn(
        api_key=api_key, location=search["location"],
        radius_meters=search["radius_meters"],
        included_types=search["verticals"], max_results=search["batch_size"],
    )
    fresh = dedupe(businesses, seen)

    leads = [score_business(b, cfg["weights"], icp) for b in fresh]
    write_leads_csv(leads_path, leads)

    threshold = search["score_threshold"]
    qualified = [l for l in leads if l.track != "low_fit" and l.score >= threshold]
    campaigns = [generate_campaign(l, cfg["personal"]) for l in qualified]
    write_campaigns_csv(campaigns_path, campaigns)

    for b in fresh:
        seen.add(b.place_id)
    save_seen(seen_path, seen)
    return len(fresh)


def main(argv=None):
    parser = argparse.ArgumentParser(description="MPG merchant lead generator")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--seen", default="seen.json")
    args = parser.parse_args(argv)

    try:
        cfg = load_config(args.config)
    except ConfigError as e:
        print(f"Config error: {e}", file=sys.stderr)
        return 2

    today = date.today().isoformat()
    leads_path = f"leads_{today}.csv"
    campaigns_path = f"campaigns_{today}.csv"

    try:
        n = run_pipeline(
            {"search": cfg.search, "personal": cfg.personal, "weights": cfg.weights},
            api_key=cfg.api_key, fetch_fn=fetch_nearby, seen_path=args.seen,
            leads_path=leads_path, campaigns_path=campaigns_path,
        )
    except RuntimeError as e:
        print(f"Fetch failed: {e}", file=sys.stderr)
        return 1

    if n == 0:
        print("No new leads this run — all results were already seen, or the "
              "search was too narrow. Try widening radius or verticals.")
    else:
        print(f"Done. {n} new leads → {leads_path}; campaigns → {campaigns_path}")
    print("Reminder: contact only businesses you may lawfully reach. "
          "This tool is not legal advice.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_cli.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full suite**

Run: `pytest -v`
Expected: PASS (all tests across every module)

- [ ] **Step 6: Commit**

```bash
git add src/mpg_leads/cli.py tests/test_cli.py
git commit -m "feat: CLI pipeline wiring with error handling"
```

---

## Task 12: End-to-end smoke test (manual, documented)

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md` with run instructions**

````markdown
# MPG Merchant Services Lead Generator

Standalone CLI: fetches Houston-area merchants (Google Places API), scores them
on a two-track model (Displacement / Greenfield), and generates outreach copy.

## Setup

```bash
pip install -r requirements.txt --break-system-packages
cp config.example.yaml config.yaml   # then edit config.yaml
export GOOGLE_PLACES_API_KEY="your-key-here"
```

## Run

```bash
python -m mpg_leads.cli --config config.yaml
```

Outputs `leads_YYYY-MM-DD.csv` and `campaigns_YYYY-MM-DD.csv` in the current
directory. Re-runs skip merchants already recorded in `seen.json`.

## Tests

```bash
pytest -v
```

## Notes / limitations

- SMS and voicemail are generated as copy only — you send them yourself. No
  automated sending in this version.
- The review-keyword scan is a heuristic; check the `why` column before dialing.
- The tool cannot see a merchant's actual processor or contract end-date; the
  score predicts switch-likelihood, not a guaranteed opening.
- Not legal advice. Confirm you may lawfully contact a business before outreach.
````

- [ ] **Step 2: Verify the package imports and CLI help works (no API key needed)**

Run: `python -m mpg_leads.cli --help`
Expected: argparse help text prints, exit 0.

- [ ] **Step 3: Verify config error path is clean (no key set)**

Run: `unset GOOGLE_PLACES_API_KEY; cp config.example.yaml config.yaml; python -m mpg_leads.cli --config config.yaml; echo "exit=$?"`
Expected: prints `Config error: GOOGLE_PLACES_API_KEY environment variable is not set...` and `exit=2`.

- [ ] **Step 4: (Optional, costs API credits) Real batch smoke test**

With a valid key exported and a small `radius_meters` (e.g. 3000) and `batch_size: 5`, run:
Run: `python -m mpg_leads.cli --config config.yaml`
Expected: two CSVs written; `leads_*.csv` sorted best-first; `campaigns_*.csv` has one row per qualified lead. Spot-check that a Displacement row's copy says "switch/rate" and a Greenfield row's copy says "set up."

- [ ] **Step 5: Commit**

```bash
git add README.md config.yaml
git commit -m "docs: README with setup, run, and limitations"
```

Note: `config.yaml` is gitignored by default in real use (it holds personal
details); committing the example-derived copy here is only to record the smoke
test. Remove it from the commit if it contains real personal data.

---

## Self-Review

**Spec coverage:**
- Config-driven runs → Task 3 + `config.example.yaml` (Task 1). ✓
- Places API fetch, ToS fields, pagination/retry, dedupe → Task 9. ✓
- Two-track classify + score + why array → Tasks 4–7. ✓
- Vertical-as-gate (not scorer) → Task 4 (`classify_track`) + ±3 tiebreak in Task 7. ✓
- Track-aware campaigns, no cross-angle bleed, CAN-SPAM footer, generate-only SMS/VM → Task 8. ✓
- CSV export, sorted best-first, all copy columns → Task 10. ✓
- Error handling (missing key, rate limits, zero results, partial writes) → Tasks 3, 9, 11. ✓
- Test-first across scoring/campaigns/fetcher(fixture)/export + E2E smoke → Tasks 4–12. ✓
- Honest-limitations surfaced to user → README (Task 12) + why array. ✓

**Placeholder scan:** No TBD/TODO; every code and test step contains complete content. ✓

**Type consistency:** `Business`/`ScoredLead`/`Campaign` field names used identically in models, scoring, campaigns, export, cli. `track` values ("displacement"/"greenfield"/"low_fit") and `bucket` values ("hot"/"warm"/"cold") consistent across scoring, campaigns, export, cli. `weights` dict shape identical in config example, scoring tests, and cli test. ✓

**One known cross-boundary note:** Places `primaryType` (e.g. "hair_salon") won't always match the config vertical vocab ("salon"). The CLI test documents this via `ICP_MAP`; in real use, either list Places-native types in `config.yaml.search.verticals` or add a normalization map. Flagged here so the implementer handles it deliberately rather than being surprised.
