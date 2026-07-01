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
