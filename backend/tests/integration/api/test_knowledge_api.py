"""Tests for Knowledge-tab endpoints (v0.4.0): domains/recent/list/sync-status.

The endpoints read `kb_meta` only (no vector calls); embeddings are stubbed so
the tests don't need a live Ollama. Postgres is still required (skipped by
conftest when unavailable).
"""
import pytest
from sqlalchemy import text

import app.knowledge.ingest as ingest_mod
from app.core.security import create_access_token
from app.knowledge.ingest import ingest_article
from app.main import app
from app.persistence.database import engine, init_db


@pytest.fixture(autouse=True)
def _no_embeddings(monkeypatch):
    monkeypatch.setattr(ingest_mod, "add_texts", lambda texts, metadatas: ["stub"] * len(texts))


def _client():
    from fastapi.testclient import TestClient
    return TestClient(app)


def _hdr():
    # Use the dev ADMIN subject so domain-scoped RBAC shows all seeded domains.
    from app.core.config import SETTINGS
    admin = next(u.strip() for u in SETTINGS.dev_admin_usernames.split(",") if u.strip())
    return {"Authorization": f"Bearer {create_access_token(admin)}"}


def _seed():
    init_db()
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM kb_meta"))
    ingest_article({"page_id": "kt-db-1", "title": "DB Timeout", "domain": "database",
                    "source_url": "http://x/db-1", "body": "Check pooler and pg_hba.",
                    "updated_by": "tester"})
    ingest_article({"page_id": "kt-net-1", "title": "VPN Steps", "domain": "network",
                    "source_url": "http://x/net-1", "body": "Reconnect client.",
                    "updated_by": "tester"})


def test_domains_and_recent():
    _seed()
    c = _client()
    H = _hdr()

    r = c.get("/api/articles-domains", headers=H)
    assert r.status_code == 200
    doms = {d["domain"]: d["pages"] for d in r.json()["domains"]}
    assert doms.get("database") == 1 and doms.get("network") == 1

    r2 = c.get("/api/articles-recent?limit=5", headers=H)
    assert r2.status_code == 200
    arts = r2.json()["articles"]
    assert len(arts) >= 2 and arts[0]["title"] in {"DB Timeout", "VPN Steps"}


def test_list_filters_by_domain():
    _seed()
    c = _client()
    r = c.get("/api/articles-list", params={"domain": "database"}, headers=_hdr())
    arts = r.json()["articles"]
    assert arts and all(a["domain"] == "database" for a in arts)
    assert any(a["title"] == "DB Timeout" for a in arts)


def test_sync_status():
    _seed()
    from app.knowledge.ingest import sync_all

    sync_all(updated_by="tester")
    c = _client()
    r = c.get("/api/sync-status", headers=_hdr())
    body = r.json()
    assert body["pages"] >= 2
    assert body["healthy"] and "inserted" in body["last_run"]
