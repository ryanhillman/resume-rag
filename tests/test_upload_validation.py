from unittest.mock import patch

import pytest
from fpdf import FPDF


def _pdf(pages: int = 1, text: str = "") -> bytes:
    pdf = FPDF()
    for i in range(pages):
        pdf.add_page()
        if text and i == 0:
            pdf.set_font("Helvetica", size=12)
            pdf.cell(0, 10, text)
    return bytes(pdf.output())


def test_rejects_non_pdf(client):
    resp = client.post(
        "/upload",
        files={"file": ("resume.docx", b"not a pdf", "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert ".pdf" in resp.json()["detail"]


def test_rejects_oversize_pdf(client):
    from app.main import MAX_UPLOAD_BYTES

    resp = client.post(
        "/upload",
        files={"file": ("resume.pdf", b"x" * (MAX_UPLOAD_BYTES + 1), "application/pdf")},
    )
    assert resp.status_code == 413
    assert "5 MB" in resp.json()["detail"]


@pytest.mark.parametrize("tags", ["Java", "5", '{"Java": 1}', '["Java", 5]'])
def test_rejects_malformed_tags(client, tags):
    resp = client.post(
        "/upload",
        files={"file": ("resume.pdf", _pdf(text="Ryan Hillman"), "application/pdf")},
        data={"tags": tags},
    )
    assert resp.status_code == 400
    assert "JSON array" in resp.json()["detail"]


def test_rejects_multi_page_pdf(client):
    resp = client.post(
        "/upload",
        files={"file": ("resume.pdf", _pdf(pages=2, text="Hello"), "application/pdf")},
    )
    assert resp.status_code == 400
    assert "one-page" in resp.json()["detail"]


def test_rejects_scanned_pdf(client):
    resp = client.post(
        "/upload",
        files={"file": ("resume.pdf", _pdf(), "application/pdf")},
    )
    assert resp.status_code == 400
    assert "text" in resp.json()["detail"].lower()


def test_accepts_valid_one_page_pdf(client):
    with (
        patch("app.main._get_resume_by_hash", return_value=None),
        patch("app.main._register_resume"),
        patch("app.main.BackgroundTasks.add_task"),
    ):
        resp = client.post(
            "/upload",
            files={"file": ("resume.pdf", _pdf(pages=1, text="Ryan Hillman Software Engineer"), "application/pdf")},
        )
    assert resp.status_code == 200
    assert "resume_id" in resp.json()


def test_rejects_duplicate_upload(client):
    with patch(
        "app.main._get_resume_by_hash",
        return_value={"resume_id": "existing-id", "filename": "original.pdf"},
    ):
        resp = client.post(
            "/upload",
            files={"file": ("resume.pdf", _pdf(pages=1, text="Some resume text"), "application/pdf")},
        )
    assert resp.status_code == 409
    assert "already uploaded" in resp.json()["detail"]


# --- Retry failed ingests ---


def test_retry_failed_resume(client):
    with (
        patch("app.main._claim_failed_resume", return_value=True) as mock_claim,
        patch("app.main._get_resume_file", return_value=(b"%PDF", "r.pdf")),
        patch("app.main._retry_ingest") as mock_retry,
    ):
        resp = client.post("/resumes/abc/retry")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ingesting"
    mock_claim.assert_called_once_with("abc")
    mock_retry.assert_called_once_with("abc", "r.pdf", b"%PDF")


def test_retry_rejects_non_failed_resume(client):
    with (
        patch("app.main._get_resume_file", return_value=(b"%PDF", "r.pdf")),
        patch("app.main._claim_failed_resume", return_value=False),
        patch("app.main._retry_ingest") as mock_retry,
    ):
        resp = client.post("/resumes/abc/retry")
    assert resp.status_code == 409
    mock_retry.assert_not_called()


def test_retry_missing_resume(client):
    with patch("app.main._get_resume_file", return_value=None):
        resp = client.post("/resumes/missing/retry")
    assert resp.status_code == 404


# --- Contact extraction ---


def test_extract_contact_fields():
    from app.main import _extract_contact

    text = "Tom Becker\nSenior Engineer\ntom.becker@example.com | (555) 123-4567"
    name, email, phone = _extract_contact(text, "tom_becker_resume.pdf")
    assert name == "Tom Becker"
    assert email == "tom.becker@example.com"
    assert phone == "(555) 123-4567"


def test_extract_contact_falls_back_to_filename():
    from app.main import _extract_contact

    name, email, phone = _extract_contact("EXPERIENCE\nbuilt things 2019-2023", "tom_becker_resume.pdf")
    assert name == "Tom Becker Resume"
    assert email is None
    assert phone is None


# --- File serving ---


def test_resume_file_inline_by_default(client):
    with patch("app.main._get_resume_file", return_value=(b"%PDF-1.4", "r.pdf")):
        resp = client.get("/resumes/abc/file")
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("inline;")


def test_resume_file_attachment_on_download(client):
    with patch("app.main._get_resume_file", return_value=(b"%PDF-1.4", "r.pdf")):
        resp = client.get("/resumes/abc/file?download=true")
    assert resp.headers["content-disposition"].startswith("attachment;")
