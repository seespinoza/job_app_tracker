# CLAUDE.md

## Running the App

Two processes must run simultaneously:

```bash
# Terminal 1 — backend (from repo root)
.venv/bin/uvicorn api:app --reload --host 0.0.0.0

# Terminal 2 — frontend
cd frontend && npm run dev
```

Frontend at http://localhost:5173, API at http://localhost:8000. Vite proxies `/api/*` → backend automatically.

Requires `ANTHROPIC_API_KEY` env var for AI job extraction (scraper fallback; optional — app works without it).

## Frontend build

```bash
cd frontend
npm install        # install deps
npm run build      # production build → frontend/dist/
npm run preview    # preview production build
```

## Architecture

**Backend** (`api.py`, `db.py`, `scraper.py`) — FastAPI + SQLite, no ORM.

- `api.py` — all REST endpoints under `/api/`; thin layer that calls `db` functions and returns `df_to_records()` output
- `db.py` — all SQL; `init_db()` runs on import (creates tables if missing); returns `pd.DataFrame` for reads, plain ints for writes
- `scraper.py` — job data extraction: `extract_job_from_url()` tries Jina Reader then Playwright fallback; `extract_job_from_text()` skips fetching and sends raw text directly to Claude Haiku (`claude-haiku-4-5-20251001`); every attempt is logged to `scraper_log`

**Frontend** (`frontend/src/`) — React 18 + React Router + Recharts + react-simple-maps.

- `src/api.js` — single `api` object with all fetch calls; all requests go to `/api` (proxied by Vite)
- `src/App.jsx` — route definitions; one route per page component
- `src/pages/` — seven pages, each fetches its own data on mount
- `src/components/` — `Layout.jsx` (sidebar nav), `MetricCard.jsx` (reusable stat card)

**Database** (`job_tracker.db` — SQLite, in repo root, not committed):

Four tables:
- `job_applications` — completed/tracked applications (company, title, status, dates, salary, location)
- `todo_applications` — pending queue; `move_todo_to_applied()` atomically transfers a row into `job_applications`
- `scraper_log` — one row per extraction attempt (method: `jina`, `playwright`, or `manual_text`; success, latency_ms, error)
- `notes` — freeform markdown notes (title, content)

**`locations` storage:** Stored as a JSON string (`'[{"city":"…","state":"…"}]'`) in SQLite for both `job_applications` and `todo_applications`. Every `db.py` read deserializes it with `json.loads`; every write serializes with `json.dumps`. Raw SQL queries against these tables must handle this manually.

**Schema migration:** `init_db()` runs idempotent `ALTER TABLE ADD COLUMN` statements on startup. Adding a new column to `job_applications` or `todo_applications` means adding it to that block in `init_db()` and to the INSERT/UPDATE statements.

**Data flow for AI job extraction:**

*From URL* (New Application / To-Do pages):
1. User pastes URL → `POST /api/extract`
2. `scraper.extract_job_from_url()` tries Jina Reader, then Playwright
3. Raw text → Claude Haiku → structured JSON
4. Frontend pre-fills form; user reviews and saves

*From raw text* (Raw Job Text section on both pages):
1. User pastes text, optionally edits → clicks "Extract with AI ✨" → `POST /api/extract-text`
2. `scraper.extract_job_from_text()` sends text directly to Claude Haiku
3. Same structured JSON → same form pre-fill

## Enum values (defined in `db.py`, served via `GET /api/config`)

- `JOB_TYPES`: `["Data Scientist", "ML Engineer", "AI Engineer", "Other"]`
- `JOB_STATUSES`: `["applied", "interviewing", "offer", "declined", "inactive"]`
- `JOB_SOURCES`: LinkedIn, Indeed, Glassdoor, Company Website, Referral, Handshake, Other

Adding a new value means updating `db.py`. The frontend fetches these from `/api/config`, **except `InProgress.jsx`**, which hardcodes all four enum lists locally (STATUS_OPTIONS, JOB_TYPES, JOB_SOURCES, WORK_ARRANGEMENTS) — it must be updated manually whenever any enum changes.

## Utility scripts

- `backfill_raw_text.py` — one-shot script to fetch and store raw job text via Jina for existing `job_applications` rows that have a `job_link` but no `raw_text`. Run from repo root: `.venv/bin/python backfill_raw_text.py`

## LAN access

Both servers bind to `0.0.0.0`, so any device on the same network can reach the app at `http://<host-ip>:5173`. On Fedora, you may need to open the port temporarily: `sudo firewall-cmd --add-port=5173/tcp`.

## Database Backups — DO NOT TOUCH

**IMPORTANT: Never read, edit, move, delete, chmod, or otherwise interact with files in `~/.job_tracker_backups/`.** These are protected backups of the user's job application data. Every write to `job_applications` or `todo_applications` automatically creates a timestamped read-only copy there (via `backup_db()` in `db.py`). The last 10 backups are kept. This data is critical for the user's job search and must not be modified or destroyed under any circumstances.

## Not yet implemented

- Automated job discovery scraper (browsing job boards to find new postings)
- Email notification system
- Tiered API scraper (Greenhouse/Lever public API → Jina → Playwright XHR)
