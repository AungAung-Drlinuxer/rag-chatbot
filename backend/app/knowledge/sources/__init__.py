"""Knowledge sources — per-system article fetchers used by loaders.py.

confluence.py is live; a Jira source (resolved tickets as KB) is planned but
not implemented, so no module ships for it (GOVERNANCE: no dead scaffolding).
"""
from app.knowledge.sources import confluence

__all__ = ["confluence"]
