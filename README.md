# Resume RAG

<p align="center">
  <img alt="Azure" src="https://img.shields.io/badge/Azure-0078D4?logo=microsoftazure&logoColor=white" />
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" />
  <img alt="RAG" src="https://img.shields.io/badge/RAG-4B5563" />
</p>

Upload resumes and ask questions about contents.

Built and tested to WCAG 2.2 AA standards for business use.

## [Demo](https://youtu.be/_k4RPeDIqqk)

## Screenshot

![Resume RAG: uploading and the candidate list on the left, a question and its answer on the right](docs/screenshot.png)

## Tech Stack

- FastAPI
- Azure OpenAI + VM
- PostgreSQL + pgvector
- Docker Compose + Caddy
- Terraform

## Architecture

```mermaid
flowchart TD
    Browser["Staff Browser"]

    subgraph VM["Azure VM"]
        Caddy["Caddy\n(TLS / reverse proxy)"]
        App["FastAPI\nrag-app"]
        PG[("PostgreSQL\n+ pgvector")]
    end

    subgraph Azure["Azure AI Services"]
        Embed["text-embedding-3-small"]
        LLM["gpt-5-nano"]
    end

    Browser -- "HTTPS" --> Caddy --> App

    App -- "POST /login → session cookie" --> Browser

    App -- "1 · embed chunks" --> Embed
    Embed -- "1536-dim vectors" --> App
    App -- "2 · INSERT embeddings" --> PG

    App -- "3 · embed question\n(unfiltered questions only)" --> Embed
    App -- "4 · cosine similarity search\n(unfiltered questions only)" --> PG
    PG -- "all chunks in scope (filtered)\ntop-2/candidate, ≤40 candidates (unfiltered)" --> App
    App -- "5 · chat completion\n(chunks + question)" --> LLM
    LLM -- "answer" --> App --> Browser
```

**Ingest (steps 1–2):** PDF upload → chunk text → embed with Azure → store vectors in pgvector

**Query (steps 3–5):** one LLM call per question. Single-resume and tag-filtered questions send every chunk in scope, no ranking or cap. Unfiltered questions take the top 2 chunks from the 40 nearest candidates by cosine similarity; rank/compare/list questions also include a one-line roster of every candidate so none get cut.

## Setup

Needs Terraform, the Azure CLI (signed in) and the GitHub CLI. The repository is
wired to one deployment: for your own, set `prefix` in `terraform.tfvars` (the
default is this deployment's hostname) and change the state storage account in
`infra/backend.tf`, the OIDC subject in `infra/main.tf`, and the clone URL and
VM name in `.github/workflows/deploy.yml`.

**1. Provision infrastructure**
```bash
cd infra && cp terraform.tfvars.example terraform.tfvars  # fill in values
terraform init && terraform apply
```

**2. Configure the VM's environment**

Copy `.env.example` to `~/.env` on the VM and fill in every variable. The
Azure endpoint, key and `DOMAIN` come from `terraform output` (`ai_endpoint`,
`-raw ai_key`, `hostname`); the rest you choose. `DOMAIN` must be that hostname:
Caddy gets its certificate for it, and the session cookie is `Secure`, so
sign-in fails over plain HTTP.

**3. Deploy via CI/CD**

CI authenticates to Azure with a short-lived OIDC token and asks the VM to
deploy itself; the VM pulls the tested commit from GitHub. No secrets are
stored and nothing connects inbound.

```bash
cd infra
gh variable set AZURE_CLIENT_ID       --body "$(terraform output -raw deploy_client_id)"
gh variable set AZURE_TENANT_ID       --body "$(terraform output -raw deploy_tenant_id)"
gh variable set AZURE_SUBSCRIPTION_ID --body "$(terraform output -raw subscription_id)"
```

Push to `main` — the checks run, then the deploy.

## Tests

```bash
pip install -r requirements.txt -r requirements-dev.txt
pytest tests/
```

## API

✓ means a session cookie or an `X-API-Key` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Web UI, or the sign-in page when there is no session |
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
| `POST` | `/upload` | ✓ | Upload a PDF resume: one page, text-based, 5 MB max |
| `POST` | `/chat` | ✓ | Ask a question (`resume_id`, `resume_ids`, or `tags` optional); returns `answer` + `sources` |
