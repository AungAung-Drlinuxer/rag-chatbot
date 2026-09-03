"""Classifier result model."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Classification:
    """A domain classification with its Stage-1 confidence (0..1)."""

    domain: str
    confidence: float

    def as_tuple(self) -> tuple[str, float]:
        return self.domain, self.confidence
