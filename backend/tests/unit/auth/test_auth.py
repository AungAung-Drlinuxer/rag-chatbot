"""Phase 5 auth unit tests — dev backdoor fallback + JWT (no network/LDAP needed)."""
import pytest

from app.auth import ldap as ldap_mod
from app.auth.ldap import authenticate
from app.core.config import SETTINGS
from app.core.security import create_access_token, create_refresh_token, decode_token


@pytest.fixture
def dev_backdoor(monkeypatch):
    """Activate the dev backdoor as dev/dev (prod default is a hidden account)."""
    monkeypatch.setattr(ldap_mod, "DEV_PASSWORD", "dev")
    monkeypatch.setattr(SETTINGS, "auth_dev_user", "dev")
    return True


def test_dev_login_ok(dev_backdoor):
    assert authenticate("dev", "dev") == "dev"


def test_dev_login_bad_password(dev_backdoor):
    assert authenticate("dev", "wrong") is None


def test_dev_login_unknown_user(dev_backdoor):
    assert authenticate("nobody", "dev") is None


def test_jwt_roundtrip():
    token = create_access_token("jsmith")
    assert decode_token(token) == "jsmith"


def test_jwt_refresh_token():
    token = create_refresh_token("jsmith")
    # refresh tokens are only valid with expected_type="refresh" (v0.18.1)
    assert decode_token(token, expected_type="refresh") == "jsmith"


def test_jwt_access_cannot_be_used_as_refresh():
    token = create_access_token("jsmith")
    with pytest.raises(ValueError):
        decode_token(token, expected_type="refresh")


def test_jwt_rejects_garbage():
    from jose import JWTError

    with pytest.raises(JWTError):
        decode_token("not-a-token")
