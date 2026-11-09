import hashlib
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

_live_sessions: set[str] = set()


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@pytest.fixture(scope="module")
def bare_client():
    with (
        patch("app.main._init_db"),
        patch("app.main._sessions_purge"),
        patch("app.main._session_create", side_effect=lambda t, _: _live_sessions.add(_h(t))),
        patch("app.main._session_delete", side_effect=lambda t: _live_sessions.discard(_h(t))),
        patch("app.main._session_valid", side_effect=lambda t: _h(t) in _live_sessions),
    ):
        from app.main import app

        with TestClient(app, follow_redirects=False, base_url="https://testserver") as c:
            yield c


@pytest.fixture(autouse=True)
def _reset(bare_client):
    from app.main import _LOGIN_ATTEMPTS

    _LOGIN_ATTEMPTS.clear()
    _live_sessions.clear()
    bare_client.cookies.clear()
    yield


# --- Sign-in ---


def test_correct_password_redirects(bare_client):
    resp = bare_client.post("/login", data={"password": "test-password"})
    assert resp.status_code == 303
    assert "rag_session" in resp.cookies


def test_wrong_password_returns_401(bare_client):
    resp = bare_client.post("/login", data={"password": "wrong-password"})
    assert resp.status_code == 401


def test_rate_limit_after_max_failures(bare_client):
    from app.main import _LOGIN_MAX_FAILURES

    for _ in range(_LOGIN_MAX_FAILURES):
        bare_client.post("/login", data={"password": "wrong"})
    resp = bare_client.post("/login", data={"password": "wrong"})
    assert resp.status_code == 429


def test_lockout_blocks_even_a_correct_password(bare_client):
    """The lockout must gate the password check. If a correct password were still
    honoured while locked out, an attacker's eventual right guess would be let
    through and the lockout would throttle nothing."""
    from app.main import _LOGIN_MAX_FAILURES

    for _ in range(_LOGIN_MAX_FAILURES):
        bare_client.post("/login", data={"password": "wrong"})
    resp = bare_client.post("/login", data={"password": "test-password"})
    assert resp.status_code == 429
    assert "rag_session" not in resp.cookies


def test_lockout_not_bypassable_by_spoofing_forwarded_for(bare_client):
    """Caddy sets X-Forwarded-For to the client's address, so the last entry is
    the trustworthy one. Rotating a client-supplied prefix must not open a new
    bucket."""
    from app.main import _LOGIN_MAX_FAILURES

    for i in range(_LOGIN_MAX_FAILURES):
        bare_client.post(
            "/login",
            data={"password": "wrong"},
            headers={"X-Forwarded-For": f"{i}.{i}.{i}.{i}, 10.0.0.5"},
        )
    resp = bare_client.post(
        "/login",
        data={"password": "wrong"},
        headers={"X-Forwarded-For": "9.9.9.9, 10.0.0.5"},
    )
    assert resp.status_code == 429


def test_lockout_is_scoped_to_the_real_client_ip(bare_client):
    """A genuinely different client must not inherit another IP's lockout."""
    from app.main import _LOGIN_MAX_FAILURES

    for _ in range(_LOGIN_MAX_FAILURES):
        bare_client.post(
            "/login",
            data={"password": "wrong"},
            headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.5"},
        )
    resp = bare_client.post(
        "/login",
        data={"password": "wrong"},
        headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.9"},
    )
    assert resp.status_code == 401


# --- Sessions ---


def test_valid_session_grants_access(bare_client):
    bare_client.post("/login", data={"password": "test-password"})
    with patch("app.main._list_resumes", return_value=[]):
        resp = bare_client.get("/resumes")
    assert resp.status_code == 200


def test_missing_session_returns_401(bare_client):
    resp = bare_client.get("/resumes")
    assert resp.status_code == 401


def test_invalid_session_token_returns_401(bare_client):
    resp = bare_client.get("/resumes", cookies={"rag_session": "not-a-real-token"})
    assert resp.status_code == 401


# --- CSRF ---


def test_csrf_matching_origin_passes(bare_client):
    resp = bare_client.post(
        "/login",
        data={"password": "test-password"},
        headers={"origin": "https://testserver"},
    )
    assert resp.status_code == 303


def test_csrf_mismatched_origin_blocked(bare_client):
    resp = bare_client.post(
        "/login",
        data={"password": "test-password"},
        headers={"origin": "https://evil.example.com"},
    )
    assert resp.status_code == 403


def test_csrf_no_origin_allowed(bare_client):
    resp = bare_client.post("/login", data={"password": "test-password"})
    assert resp.status_code == 303


def test_csrf_skipped_for_valid_api_key(bare_client):
    """API-key clients can't be CSRF'd — a cross-site page can't attach the
    header — so a mismatched Origin must not block them."""
    resp = bare_client.post(
        "/login",
        data={"password": "test-password"},
        headers={"origin": "https://evil.example.com", "X-API-Key": "test-api-key"},
    )
    assert resp.status_code == 303


def test_csrf_still_blocks_invalid_api_key(bare_client):
    resp = bare_client.post(
        "/login",
        data={"password": "test-password"},
        headers={"origin": "https://evil.example.com", "X-API-Key": "wrong-key"},
    )
    assert resp.status_code == 403


def test_security_headers_on_every_response(client):
    res = client.get("/health")
    assert res.headers["Strict-Transport-Security"].startswith("max-age=")
    assert res.headers["Referrer-Policy"] == "no-referrer"
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'self'" in res.headers["Content-Security-Policy"]
