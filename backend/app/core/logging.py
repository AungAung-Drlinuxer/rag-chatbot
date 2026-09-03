"""Central logging configuration (GOVERNANCE core/: shared infrastructure)."""
from __future__ import annotations

import logging


def setup_logging(level: int = logging.INFO) -> None:
    """Configure the root logger once at app startup (idempotent)."""
    logging.basicConfig(level=level)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
