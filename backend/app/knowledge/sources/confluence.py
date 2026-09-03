"""Confluence KB source — articles from all configured spaces."""
from __future__ import annotations

from app.core.config import SETTINGS
from app.integrations.confluence import fetch_space


def load(spaces: str | None = None) -> list[dict]:
    """Fetch + tag articles from every configured space key (comma-separated)."""
    keys = spaces if spaces is not None else SETTINGS.confluence_space_keys
    articles: list[dict] = []
    for space in [s.strip() for s in keys.split(",") if s.strip()]:
        for a in fetch_space(space):
            a["domain"] = a.get("domain") or space.lower()
            articles.append(a)
    return articles
