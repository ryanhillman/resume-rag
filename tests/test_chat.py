from unittest.mock import patch


def _fake_call_llm(names):
    """Echo back which candidate names reached the prompt."""
    def fake(message, chunks, scope_note=""):
        seen = [n for n in names if any(n in c for c in chunks)]
        return "Ranking: " + ", ".join(seen)
    return fake


def test_tag_scope_sends_every_candidate(client):
    """An explicit tag scope sends ALL matching candidates — no similarity
    ranking, no cap, no question embedding — even above MAX_POOL_CANDIDATES."""
    names = [f"Candidate {i:02d}" for i in range(25)]
    ids = [f"id-{i}" for i in range(25)]
    chunks = [f"Candidate: {n}\n\nEngineer." for n in names]

    with (
        patch("app.main._get_resume_ids_by_tags", return_value=ids),
        patch("app.main._get_candidates", return_value=[]),
        patch("app.main._fetch_all_chunks", return_value=chunks) as mock_fetch,
        patch("app.main._call_llm", side_effect=_fake_call_llm(names)),
        patch("app.main._embed_texts", side_effect=AssertionError("explicit scope must not embed")),
        patch("app.main._retrieve_chunks", side_effect=AssertionError("explicit scope must not rank")),
    ):
        res = client.post(
            "/chat", json={"message": "rank the Kubernetes people", "tags": ["Kubernetes"]},
        )

    assert res.status_code == 200
    for name in names:
        assert name in res.json()["answer"]
    assert mock_fetch.call_args[0][0] == ids


def test_resume_ids_scope_returns_sources(client):
    """A resume_ids scope (UI checkboxes) fetches exactly those candidates'
    chunks and returns sources for linking answers back to candidates."""
    ids = ["id-1", "id-2", "id-3"]
    sources = [{"resume_id": i, "candidate_name": f"Person {i}"} for i in ids]

    with (
        patch("app.main._get_candidates", return_value=sources) as mock_cands,
        patch("app.main._fetch_all_chunks", return_value=["chunk"]) as mock_fetch,
        patch("app.main._call_llm", return_value="comparison"),
        patch("app.main._embed_texts", side_effect=AssertionError("explicit scope must not embed")),
    ):
        res = client.post("/chat", json={"message": "compare these three", "resume_ids": ids})

    assert res.status_code == 200
    assert res.json()["sources"] == sources
    assert mock_fetch.call_args[0][0] == ids
    assert mock_cands.call_args[0][0] == ids


def test_unfiltered_rank_question_gets_full_roster(client):
    """rank/compare/list questions over the whole pool prepend a roster line
    for every ready candidate, so none are dropped by similarity ranking."""
    resumes = [
        {
            "filename": f"candidate_{i:02d}.pdf",
            "status": "ready",
            "tags": ["Python"],
            "text_preview": f"Engineer number {i} with experience.",
            "candidate_name": f"Candidate {i:02d}",
        }
        for i in range(50)
    ]
    names = [f"Candidate {i:02d}" for i in range(50)]

    captured = {}

    def fake_call_llm(message, chunks, scope_note=""):
        captured["roster"] = chunks[0]
        captured["scope_note"] = scope_note
        return "ok"

    with (
        patch("app.main._list_resumes", return_value=resumes),
        patch("app.main._get_candidates", return_value=[]),
        patch("app.main._embed_texts", return_value=[[0.0] * 1536]),
        patch("app.main._retrieve_chunks", return_value=["some chunk"]),
        patch("app.main._call_llm", side_effect=fake_call_llm),
    ):
        res = client.post("/chat", json={"message": "Rank candidates by seniority."})

    assert res.status_code == 200
    for name in names:
        assert name in captured["roster"]
    assert "50 candidates in scope" in captured["scope_note"]
