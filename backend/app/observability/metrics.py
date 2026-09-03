"""App metrics (OTel counters/histograms → Mimir), best-effort NEVER raises.

State is configured once by `telemetry.setup_telemetry()`; without a configured
meter every record_* call is a no-op (observability is additive).
"""
from __future__ import annotations

import logging

logger = logging.getLogger("metrics")

_enabled = False
_meter = None
_counters: dict = {}
_histograms: dict = {}


def configure_meter(meter) -> None:
    """Enable metric recording with the given OTel meter (called at startup)."""
    global _enabled, _meter
    _meter = meter
    _enabled = meter is not None


def record_counter(name: str, value: int = 1, attrs: dict | None = None) -> None:
    if not _enabled or _meter is None:
        return
    if name not in _counters:
        _counters[name] = _meter.create_counter(name)
    _counters[name].add(value, attrs or {})


def record_histogram(name: str, value: float, attrs: dict | None = None) -> None:
    if not _enabled or _meter is None:
        return
    if name not in _histograms:
        _histograms[name] = _meter.create_histogram(name)
    _histograms[name].record(value, attrs or {})
