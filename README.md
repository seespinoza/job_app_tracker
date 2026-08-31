# Job Application Tracker

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Installation

Full step-by-step guide with per-OS commands and troubleshooting: **[SETUP.md](SETUP.md)**. Quick version below.

**Prerequisites:** Python 3.11+, Node.js 18+, git.

**Windows, no terminal:** double-click [`windows/setup_and_run.bat`](windows/setup_and_run.bat) — it installs Python/Node if missing, sets everything up, and launches both servers. Everything below is the manual path.

```bash
git clone <repo-url>
cd job_app_tracker

# 1. Python backend
python3 -m venv .venv
source .venv/bin/activate            # Windows (PowerShell): .venv\Scripts\activate
pip install -r requirements.txt

# 2. Playwright browser — optional fallback scraper for sites that block Jina Reader
playwright install chromium          # ~150 MB; skip if unsure, add later

# 3. Frontend
cd frontend && npm install && cd ..
```

**API keys — both optional, the app runs without either:**

- `ANTHROPIC_API_KEY` — enables AI job extraction (paste a job URL/text → structured fields auto-fill). Put it in a `.env` file in the repo root: `ANTHROPIC_API_KEY=sk-ant-...` ([get one](https://console.anthropic.com/keys)).
- **Jina Reader key** — keyless `r.jina.ai` requests are now rate limited / IP-blocked (HTTP 403 "malicious requests"). Add a key in the running app under **Scraper Log → Jina Reader API Key** ([get one](https://jina.ai/reader)); it's stored in the local database. Or set a `JINA_API_KEY` env var instead.

The SQLite database (`job_tracker.db`) is created automatically on first run — no migration step.

## Running the App

Two processes must run simultaneously:

```bash
# Terminal 1 — backend (from repo root)
.venv/bin/uvicorn api:app --reload --host 0.0.0.0

# Terminal 2 — frontend
cd frontend && npm run dev
```

**Windows (PowerShell):** `.venv\Scripts\uvicorn.exe api:app --reload --host 0.0.0.0` in place of the `.venv/bin/uvicorn` line above. Non-technical users can instead double-click `windows/setup_and_run.bat`, which installs dependencies if needed and launches both servers. Full cross-OS steps: [SETUP.md](SETUP.md).

Frontend at http://localhost:5173, API at http://localhost:8000. Vite proxies `/api/*` → backend automatically.

API keys (`ANTHROPIC_API_KEY`, Jina Reader) are optional — see [Installation](#installation).

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

Both servers bind to `0.0.0.0`, so any device on the same network can reach the app at `http://<host-ip>:5173`. On Fedora, you may need to open the port temporarily: `sudo firewall-cmd --add-port=5173/tcp`. On Windows, Defender Firewall usually prompts on first launch; otherwise: `netsh advfirewall firewall add rule name="JobTracker" dir=in action=allow protocol=TCP localport=5173,8000` (elevated PowerShell). Find your IP with `hostname -I` (Linux/Mac) or `ipconfig` (Windows).

## Database Backups — DO NOT TOUCH

**IMPORTANT: Never read, edit, move, delete, chmod, or otherwise interact with files in `~/.job_tracker_backups/`.** These are protected backups of the user's job application data. Every write to `job_applications` or `todo_applications` automatically creates a timestamped read-only copy there (via `backup_db()` in `db.py`). The last 10 backups are kept. This data is critical for the user's job search and must not be modified or destroyed under any circumstances.

## Not yet implemented

- Automated job discovery scraper (browsing job boards to find new postings)
- Email notification system
- Tiered API scraper (Greenhouse/Lever public API → Jina → Playwright XHR)
