"""One resume through its whole life on a real Postgres, with the model calls stubbed.
Runs when POSTGRES_PASSWORD is set, as the Check job does; skipped otherwise."""

import os
from unittest.mock import patch

import pytest
from fpdf import FPDF

# Imported here because the shared client fixture patches this name for the session.
from app.main import _init_db

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGRES_PASSWORD"), reason="needs Postgres")

EMBEDDING = [0.1] * 1536


def _resume_pdf() -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    for line in ("Dana Whitfield", "dana.whitfield@example.com", "Six years of Python services."):
        pdf.cell(0, 10, line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def test_a_resume_from_upload_to_delete(client):
    _init_db()
    upload = {"file": ("dana_whitfield.pdf", _resume_pdf(), "application/pdf")}
    with (
        patch("app.main._embed_texts", side_effect=lambda texts: [EMBEDDING] * len(texts)),
        patch("app.main._call_llm", return_value="An answer.") as llm,
    ):
        created = client.post("/upload", files=upload, data={"tags": '["Python"]'})
        assert created.status_code == 200
        resume_id = created.json()["resume_id"]
        try:
            # Ingest is a background task, which the test client finishes before it returns.
            listed = next(r for r in client.get("/resumes").json()["resumes"] if r["resume_id"] == resume_id)
            assert listed["status"] == "ready"
            assert (listed["candidate_name"], listed["tags"]) == ("Dana Whitfield", ["Python"])

            everyone = client.post("/chat", json={"message": "Who knows Python?"}).json()
            assert everyone["answer"] == "An answer."
            assert resume_id in [s["resume_id"] for s in everyone["sources"]]
            assert any("Candidate: Dana Whitfield" in chunk for chunk in llm.call_args.args[1])

            tagged = client.post("/chat", json={"message": "Summarize them.", "tags": ["Python"]}).json()
            assert resume_id in [s["resume_id"] for s in tagged["sources"]]

            renamed = client.patch(f"/resumes/{resume_id}", json={"candidate_name": "Dana W."})
            assert renamed.json()["candidate_name"] == "Dana W."
            assert client.put(f"/resumes/{resume_id}/tags", json={"tags": ["Senior"]}).status_code == 200
            assert client.get(f"/resumes/{resume_id}").json()["status"] == "ready"

            again = client.post("/upload", files=upload)
            assert again.status_code == 409
            assert again.json()["detail"] == "File already uploaded as 'dana_whitfield.pdf'."
        finally:
            assert client.delete(f"/resumes/{resume_id}").status_code == 200
        assert client.get(f"/resumes/{resume_id}").status_code == 404
