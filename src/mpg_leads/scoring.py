from mpg_leads.models import Business, ScoredLead

FEE_KEYWORDS = ["surcharge", "cash only", "card fee", "adds 3", "card minimum",
                "convenience fee", "fee to use card", "extra to use card"]
FRICTION_KEYWORDS = ["card declined", "machine down", "card reader", "terminal",
                     "system was down", "couldn't take card", "card wasn't working"]

VERTICAL_VOLUME = {
    "restaurant": 1.0, "bar": 1.0, "cafe": 0.9, "retail": 0.85,
    "auto": 0.75, "salon": 0.7, "spa": 0.7, "professional": 0.6,
}


def classify_track(b: Business, icp: set[str], greenfield_cutoff: int) -> str:
    if b.category not in icp:
        return "low_fit"
    if b.review_count < greenfield_cutoff:
        return "greenfield"
    return "displacement"


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


def _bucket(score, buckets):
    if score >= buckets["hot"]:
        return "hot"
    if score >= buckets["warm"]:
        return "warm"
    return "cold"


def _label(category):
    return category.replace("_", " ").capitalize()


def score_business(b: Business, weights: dict, icp: set[str]) -> ScoredLead:
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
