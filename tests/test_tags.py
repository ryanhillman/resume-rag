from unittest.mock import patch

import pytest

from app.main import TAGS


def test_list_tags_returns_all(client):
    res = client.get("/tags")
    assert res.status_code == 200
    names = {t["name"] for t in res.json()["tags"]}
    assert names == set(TAGS.keys())
    for tag in res.json()["tags"]:
        assert "bg" in tag and "text" in tag


def test_update_tags_valid(client):
    with patch("app.main._set_resume_tags", return_value=True) as mock_set:
        res = client.put("/resumes/abc/tags", json={"tags": ["Python", "Senior"]})
    assert res.status_code == 200
    assert res.json() == {"resume_id": "abc", "tags": ["Python", "Senior"]}
    mock_set.assert_called_once_with("abc", ["Python", "Senior"])


def test_update_tags_unknown_tag(client):
    res = client.put("/resumes/abc/tags", json={"tags": ["Cobol"]})
    assert res.status_code == 400
    assert "Unknown tags" in res.json()["detail"]


def test_update_tags_missing_resume(client):
    with patch("app.main._set_resume_tags", return_value=False):
        res = client.put("/resumes/missing/tags", json={"tags": ["Java"]})
    assert res.status_code == 404


# --- Contact corrections ---


def test_patch_contact_returns_full_row(client):
    row = {
        "resume_id": "abc",
        "filename": "r.pdf",
        "status": "ready",
        "candidate_name": "Tom Becker",
        "email": "new@example.com",
        "phone": None,
    }
    with patch("app.main._update_resume_contact", return_value=row) as mock_update:
        res = client.patch("/resumes/abc", json={"email": "new@example.com"})
    assert res.status_code == 200
    assert res.json() == row
    mock_update.assert_called_once_with("abc", {"email": "new@example.com"})


def test_patch_contact_rejects_empty_body(client):
    res = client.patch("/resumes/abc", json={})
    assert res.status_code == 400


@pytest.mark.parametrize(
    "body",
    [
        {"candidate_name": "   "},
        {"email": "a" * 5000},
        {"email": "not-an-email"},
    ],
)
def test_patch_contact_rejects_invalid_field(client, body):
    assert client.patch("/resumes/abc", json=body).status_code == 422


def test_patch_contact_missing_resume(client):
    with patch("app.main._update_resume_contact", return_value=None):
        res = client.patch("/resumes/missing", json={"candidate_name": "X Y"})
    assert res.status_code == 404
