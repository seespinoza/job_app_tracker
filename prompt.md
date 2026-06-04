## Objective
Create a dashboard/database to track my job search activities

## Context
I am a data scientist that is recently unemployed, I want to look for jobs in the following fields:
- Data Scientist
- ML Engineer
- AI Engineer

## Tech stack
- Python + FastAPI (backend REST API)
- React + Vite (frontend)
- SQLite (job_tracker.db)

## Architecture
- `api.py` — FastAPI server, all REST endpoints under `/api/`
- `db.py` — data layer (job_applications, todo_applications, scraper_log tables)
- `scraper.py` — Jina → Playwright → Claude Haiku AI extraction pipeline
- `frontend/` — React + Vite app

## Workflow
#### 1) Adding completed job application
- Go to `New Application` page and enter information about the job
- `In Progress` shows all active applications with days since applied
  - Can switch to Map view: US choropleth by state + remote indicator

#### 2) Adding to-do job application
- Go to `To-Do` page and enter link and basic info about a job to apply to later
  - Optionally paste a job URL to auto-fill fields via AI extraction:
    - Fetch page content using Jina Reader API (`r.jina.ai/<url>`); fall back to Playwright if Jina fails
    - Pass cleaned text to Claude Haiku, which returns structured JSON (company, title, location, salary, remote, job type, etc.)
    - Pre-populate the form with extracted fields; user reviews and saves
  - Log each scrape attempt to a `scraper_log` table (URL, method used, success/fail, latency, timestamp)

#### 3) Analyzing submitted job applications
- `Analyze` page shows counts by type (DS, ML eng, AI eng), company, source, status, time series, salary

#### 4) Updating status of job application
- `In Progress` page allows inline status updates (applied → interviewing → offer / declined / inactive)
- Flags applications not updated in 30, 60, 90+ days

#### 5) Scraper performance log
- `Scraper Log` page shows all AI extraction attempts
  - Columns: URL, method (Jina vs. Playwright), success/fail, latency, timestamp
  - Aggregate stats: success rate, avg latency, per-method breakdown

#### 6) Scrape the web for new jobs
- TBD — do not implement yet

#### 7) Automated notification system
- TBD — do not implement yet

## Run
```
# Backend
uvicorn api:app --reload

# Frontend (separate terminal)
cd frontend && npm run dev
```

## Notes
#### AI-assisted scraper — tiered fetch strategy (not yet implemented)
- Many job boards (Greenhouse, Lever) expose public REST APIs; others (Workday, Indeed) load job data via internal XHR/fetch calls that can be intercepted directly in Playwright
- This enables a tiered pipeline: public API → Jina → Playwright XHR intercept → Haiku fallback, progressively sunsetting the LLM for boards where clean structured data is already available
- **Do not implement now** — revisit once the core scraper module is in place
