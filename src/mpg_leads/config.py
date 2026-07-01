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
    api_key: str | None


def load_config(path: str, require_key: bool = True) -> Config:
    try:
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
    except FileNotFoundError as e:
        raise ConfigError(f"Config file not found: {path}") from e

    for section in REQUIRED_SECTIONS:
        if section not in raw:
            raise ConfigError(f"Missing required config section: '{section}'")

    api_key = os.environ.get(API_KEY_ENV)
    if require_key and not api_key:
        raise ConfigError(
            f"{API_KEY_ENV} environment variable is not set. "
            f"Export your Google Places API key, or run in demo mode."
        )

    return Config(
        search=raw["search"],
        personal=raw["personal"],
        weights=raw["weights"],
        api_key=api_key,
    )
