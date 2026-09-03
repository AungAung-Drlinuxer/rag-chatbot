"""Domain classifier engine — Stage 1 fast keyword rules (<1ms); Stage 2 metadata fallback.

Vocabulary is externalized to `classifier_domains.yaml` (GOVERNANCE Rule 5):
domain → keywords, per-domain weights and confidence tuning all live in config,
not code.

Returns (domain, confidence). Keyword hits → high confidence. No hit → "general"
with low confidence; the pipeline then overrides the domain with the top retrieved
doc's stored domain (Stage 2 approximate ML/zero-shot fallback) when Stage 1 < 0.7.
"""
from __future__ import annotations

from pathlib import Path

import yaml

_CONFIG_PATH = Path(__file__).parent / "classifier_domains.yaml"


def _load_config() -> dict:
    return yaml.safe_load(_CONFIG_PATH.read_text(encoding="utf-8"))


_cfg = _load_config()

LOCKDOWN: str = _cfg.get("lockdown_domain", "general")
STAGE1_CONFIDENCE: float = float(_cfg.get("stage1_confidence", 0.7))
_BASE_CONF = float(_cfg.get("base_confidence", 0.75))
_PER_HIT = float(_cfg.get("per_extra_hit", 0.1))
_MAX_CONF = float(_cfg.get("max_confidence", 0.98))
_WEIGHTS: dict[str, float] = {k: float(v) for k, v in (_cfg.get("weights") or {}).items()}

# domain → list of triggering keywords (lowercased, substring match).
KEYWORD_RULES: dict[str, list[str]] = {
    domain: [kw.lower() for kw in kws] for domain, kws in (_cfg.get("domains") or {}).items()
}


def classify_domain(query: str) -> tuple[str, float]:
    """Keyword-rule classifier. Returns (domain, confidence in 0..1)."""
    text = (query or "").lower()
    best_domain, best_hits = LOCKDOWN, 0
    for domain, kws in KEYWORD_RULES.items():
        hits = sum(1 for kw in kws if kw in text) * _WEIGHTS.get(domain, 1.0)
        if hits > best_hits:
            best_domain, best_hits = domain, hits
    if best_hits == 0:
        return LOCKDOWN, 0.3
    # Scale confidence: 1 hit ~= 0.75, more hits approach the max.
    confidence = min(_BASE_CONF + _PER_HIT * (best_hits - 1), _MAX_CONF)
    return best_domain, round(confidence, 3)
