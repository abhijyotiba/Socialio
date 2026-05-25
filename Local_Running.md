# Local Running & Testing Guide

This document explains how to set up, run, and test SocialOS locally after the migration of backend cron and publishing tasks to the Python worker.

---

## 1. Environment Setup

Copy `.env.example` in the root to create your local env files for both components:

1. **Frontend (Next.js)**: Copy to `web/.env.local`
2. **Backend (Python Worker)**: Copy to `worker/.env`

Ensure you fill in the required keys, especially `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and your LLM api keys (`GROQ_API_KEY`, `GEMINI_API_KEY`).

---

## 2. Setup & Installation

### Frontend Setup
From the repository root, install the web dependencies:
```bash
pnpm install --dir web
```

### Python Worker Setup
From the repository root, sync the python virtual environment:
```bash
cd worker && uv sync
```

---

## 3. Running Locally

To run the full application, you need to start **both** the Next.js dev server and the Python worker dev server.

### Start the Frontend (Next.js)
```bash
pnpm --dir web dev
# The web interface runs at: http://localhost:3000
```

### Start the Backend (FastAPI Worker)
```bash
cd worker && uv run fastapi dev
# The backend worker runs at: http://localhost:8000
```

---

## 4. Running Tests

### Testing the Frontend (Vitest)
To run the web application unit tests:
```bash
pnpm --dir web test
```

To run linting or type-checking:
```bash
pnpm --dir web lint
pnpm --dir web typecheck
```

### Testing the Python Worker (Pytest)
To run the python worker test suite:
```bash
cd worker && uv run pytest
```

---

## 5. Running Cron Jobs Locally

Cron jobs have been migrated from Next.js serverless routes to the Python worker. They now run as FastAPI endpoints under `/cron/*` and are guarded by the `CRON_SECRET` using a `Bearer` token.

In production, these are called by an external scheduler. For local development or debugging, you can trigger them manually using `curl`:

*   **Publish Scheduled Posts (`/cron/publish-due`)**:
    ```bash
    curl -X POST http://localhost:8000/cron/publish-due -H "Authorization: Bearer <YOUR_CRON_SECRET>"
    ```
*   **Pull Metrics (`/cron/pull-metrics`)**:
    ```bash
    curl -X POST http://localhost:8000/cron/pull-metrics -H "Authorization: Bearer <YOUR_CRON_SECRET>"
    ```
*   **Token Expiry & Refresh Check (`/cron/token-expiry-check`)**:
    ```bash
    curl -X POST http://localhost:8000/cron/token-expiry-check -H "Authorization: Bearer <YOUR_CRON_SECRET>"
    ```
*   **Clean Up Orphaned Media (`/cron/cleanup-orphaned-media`)**:
    ```bash
    curl -X POST http://localhost:8000/cron/cleanup-orphaned-media -H "Authorization: Bearer <YOUR_CRON_SECRET>"
    ```

Make sure to replace `<YOUR_CRON_SECRET>` with the value defined in your env files.