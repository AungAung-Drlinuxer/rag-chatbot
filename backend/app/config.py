"""Application settings re-export.

The real Settings class + SETTINGS singleton live in `app.core.config`.
This shim exists so `from app.config import SETTINGS` keeps working as the
documented top-level settings entry point.
"""
from app.core.config import SETTINGS, Settings

__all__ = ["SETTINGS", "Settings"]
