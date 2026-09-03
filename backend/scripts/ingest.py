"""CLI ingestion — sync all configured KB sources into pgvector.

Run from `backend/`:  uv run python scripts/ingest.py [updated_by]
Equivalent to POST /api/articles/sync (or the Celery beat task) but for ops.
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.knowledge.ingest import sync_all

logging.basicConfig(level=logging.INFO)


def main() -> int:
    updated_by = sys.argv[1] if len(sys.argv) > 1 else None
    stats = sync_all(updated_by=updated_by)
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
