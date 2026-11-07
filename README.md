# Azure RAG Pipeline

<p align="center">
  <img src="https://img.shields.io/badge/Azure-0078D4?logo=microsoftazure&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/RAG-4B5563" />
</p>

Upload resumes and ask questions about contents.

**Tech Stack**
- FastAPI
- Azure OpenAI + VM
- PostgreSQL + pgvector
- Docker Compose + Caddy
- Terraform

---

## Architecture

```mermaid
flowchart TD
    Browser["Staff Browser"]

    subgraph VM["Azure VM"]
        Caddy["Caddy\n(TLS / reverse proxy)"]
        App["FastAPI\nrag-app"]
        PG[("PostgreSQL\n+ pgvector")]
    end

    subgraph Azure["Azure AI Foundry"]
        Embed["text-embedding-3-small"]
        LLM["gpt-5-nano"]
    end

    Browser -- "HTTPS" --> Caddy --> App

    App -- "POST /login → session cookie" --> Browser

    App -- "1 · embed chunks" --> Embed
    Embed -- "1536-dim vectors" --> App
    App -- "2 · INSERT embeddings" --> PG

    App -- "3 · embed question" --> Embed
    App -- "4 · cosine similarity search\n(tag-scoped or global)" --> PG
    PG -- "all chunks in scope (filtered)\ntop-2/candidate, ≤40 candidates (unfiltered)" --> App
    App -- "5 · chat completion\n(chunks + question)" --> LLM
    LLM -- "answer" --> App --> Browser
```

**Ingest (steps 1–2):** PDF upload → chunk text → embed with Azure → store vectors in pgvector

**Query (steps 3–5):** one LLM call per question. Single-resume and tag-filtered questions send every chunk in scope, no ranking or cap. Unfiltered questions take the top 2 chunks from the 40 nearest candidates by cosine similarity; rank/compare/list questions also include a one-line roster of every candidate so none get cut.

---

## Setup

**1. Provision infrastructure**
```bash
cd infra && cp terraform.tfvars.example terraform.tfvars  # fill in values
terraform init && terraform apply
```

**2. Configure secrets on the VM**

```bash
# Add to ~/.env on the VM:
APP_API_KEY=<generate: python3 -c "import secrets; print(secrets.token_urlsafe(32))">
UI_PASSWORD=<password for the staff web UI>
AZURE_EMBED_ENDPOINT=https://<subdomain>.cognitiveservices.azure.com
AZURE_EMBED_API_KEY=<Azure AI Foundry key>
RAG_DB=rag
DOMAIN=<your-hostname-or-http://ip>
```

**3. Deploy via CI/CD**

Add GitHub Actions secrets `VM_SSH_KEY` and `VM_HOST`, and variable `VM_USER`. Push to `main` — lint → audit → test → terraform → deploy.

---

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Web UI (redirects to login if no session) |
| `POST` | `/login` | — | Submit password, receive session cookie |
| `POST` | `/logout` | — | Invalidate session cookie |
| `GET` | `/health` | — | Health check |
| `GET` | `/tags` | — | Available tag definitions |
| `GET` | `/resumes` | ✓ | List resumes with status, tags, and contact info |
| `GET` | `/resumes/{id}` | ✓ | Single resume details |
| `GET` | `/resumes/{id}/file` | ✓ | View original PDF inline (`?download=true` to save) |
| `PUT` | `/resumes/{id}/tags` | ✓ | Set tags on a resume |
| `PATCH` | `/resumes/{id}` | ✓ | Correct candidate name, email, or phone |
| `POST` | `/resumes/{id}/retry` | ✓ | Re-run ingest for a failed resume |
| `DELETE` | `/resumes/{id}` | ✓ | Delete resume and its vectors |
| `POST` | `/upload` | ✓ | Upload a PDF resume |
| `POST` | `/chat` | ✓ | Ask a question (`resume_id`, `resume_ids`, or `tags` optional); returns `answer` + `sources` |
