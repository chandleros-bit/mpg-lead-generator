from mpg_leads.campaigns import generate_campaign
from mpg_leads.scoring import score_business


def build_leads(cfg: dict, businesses: list) -> list[dict]:
    """Score businesses and attach campaign copy. Returns display-ready dicts,
    sorted best-first, excluding low-fit. Campaigns are generated for every shown
    lead so copy is always one click away in the dashboard."""
    icp = set(cfg["search"]["verticals"])
    personal = cfg["personal"]
    weights = cfg["weights"]

    rows = []
    for b in businesses:
        lead = score_business(b, weights, icp)
        if lead.track == "low_fit":
            continue
        camp = generate_campaign(lead, personal)
        rows.append({
            "place_id": b.place_id,
            "name": b.name,
            "category": b.category.replace("_", " "),
            "address": b.address,
            "phone": b.phone or "",
            "website": b.website or "",
            "rating": b.rating,
            "review_count": b.review_count,
            "score": lead.score,
            "track": lead.track,
            "bucket": lead.bucket,
            "why": lead.why,
            "campaign": {
                "email1_subject": camp.email1_subject,
                "email1_body": camp.email1_body,
                "email2_subject": camp.email2_subject,
                "email2_body": camp.email2_body,
                "sms": camp.sms,
                "voicemail": camp.voicemail,
            },
        })

    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows


def summarize(rows: list[dict]) -> dict:
    return {
        "total": len(rows),
        "hot": sum(1 for r in rows if r["bucket"] == "hot"),
        "warm": sum(1 for r in rows if r["bucket"] == "warm"),
        "cold": sum(1 for r in rows if r["bucket"] == "cold"),
        "displacement": sum(1 for r in rows if r["track"] == "displacement"),
        "greenfield": sum(1 for r in rows if r["track"] == "greenfield"),
    }
