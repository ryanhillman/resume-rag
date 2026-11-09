import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("APP_API_KEY", "test-api-key")
os.environ.setdefault("UI_PASSWORD", "test-password")
os.environ.setdefault("AZURE_EMBED_ENDPOINT", "https://test.openai.azure.com")
os.environ.setdefault("AZURE_EMBED_API_KEY", "test-embed-key")


@pytest.fixture(scope="session")
def client():
    with (
        patch("app.main._init_db"),
        patch("app.main._sessions_purge"),
    ):
        from app.main import app

        with TestClient(app, headers={"X-API-Key": "test-api-key"}) as c:
            yield c
