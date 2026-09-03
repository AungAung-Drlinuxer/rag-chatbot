"""Shared test fixtures: DB readiness + runtime-override isolation.

- Ensures tables exist (best-effort init_db) for tests against the local dev
  Postgres (docker-compose.dev.yml).
- Skips tests/integration/* automatically when Postgres is unreachable, so a
  plain `pytest` run is green on any machine (services-dependent tests simply
  don't fail — they're skipped with a reason).
- Clears runtime_kv overrides after every test so one test's admin override
  can never leak into another (test_runtime_get_returns_default_when_unset).
"""
from __future__ import annotations

import pytest
from sqlalchemy import text as _text

from app.persistence.database import engine


def _pg_up() -> bool:
    try:
        with engine.connect() as c:
            c.execute(_text("SELECT 1"))
        return True
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def _database():
    if _pg_up():
        from app.persistence.database import init_db

        init_db()
    yield


def pytest_collection_modifyitems(items):
    if _pg_up():
        return
    skip = pytest.mark.skip(reason="postgres not reachable (start docker-compose.dev.yml)")
    for item in items:
        if "integration" in str(item.fspath).replace("\\", "/").split("/"):
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def _clean_runtime_overrides():
    yield
    try:
        from app.core import runtime

        for key in list(runtime.DEFS):
            runtime.reset(key)
    except Exception as exc:  # DB unavailable (skipped integration) — nothing to clean
        print(f"[conftest] runtime override cleanup skipped: {type(exc).__name__}")
