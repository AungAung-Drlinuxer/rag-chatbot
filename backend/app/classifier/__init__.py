"""Classifier subsystem — domain/technology identification.

Public surface: classify_domain() + the LOCKDOWN/STAGE1_CONFIDENCE/KEYWORD_RULES
constants (loaded from classifier_domains.yaml). Vocabulary edits go to the YAML,
never here (GOVERNANCE Rule 5).
"""
from app.classifier.classifier import (
    KEYWORD_RULES,
    LOCKDOWN,
    STAGE1_CONFIDENCE,
    classify_domain,
)
from app.classifier.models import Classification

__all__ = [
    "KEYWORD_RULES",
    "LOCKDOWN",
    "STAGE1_CONFIDENCE",
    "Classification",
    "classify_domain",
]
