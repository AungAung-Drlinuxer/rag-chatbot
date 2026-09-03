"""Phase 6 — list escalations endpoint (GET /api/escalations)."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _token() -> str:
    from app.core.security import create_access_token
    return create_access_token("dev")


def test_list_escalations_shape():
    r = client.get("/api/escalations", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200
    body = r.json()
    assert "escalations" in body
    assert isinstance(body["escalations"], list)


def test_list_escalations_requires_auth():
    assert client.get("/api/escalations").status_code in (401, 403)
