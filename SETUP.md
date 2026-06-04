# Local Setup Guide

## Prerequisites

- Python 3.11+
- Node.js 18+ and npm

---

## 1. Clone / navigate to the project

```bash
cd /path/to/job_app_tracker
```

---

## 2. Python environment

Create and activate a virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

---

## 3. Environment variables

Create a `.env` file in the project root:

```bash
cp .env.example .env   # if it exists, otherwise create manually
```

Or just create `.env` directly:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Get your key from https://console.anthropic.com/keys.

> **Note:** `ANTHROPIC_API_KEY` is only required for the AI auto-fill feature on the New Application page (URL → structured job data extraction). The rest of the app works without it.

---

## 4. Install Playwright browser (optional)

Only needed if job sites block Jina Reader and you want the Playwright fallback scraper:

```bash
playwright install chromium
```

---

## 5. Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

---

## 6. Run the app

Open **two terminals** from the project root.

**Terminal 1 — backend:**

```bash
source .venv/bin/activate
.venv/bin/uvicorn api:app --reload --host 0.0.0.0
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 in your browser.

---

## 7. Accessing from another device on the same network

The app is configured to listen on all network interfaces, so any device on the same Wi-Fi/LAN can reach it.

1. Find the laptop's local IP:
   ```bash
   hostname -I
   ```
   Look for an address like `192.168.x.x`.

2. Vite also prints it on startup:
   ```
   ➜  Network: http://192.168.1.42:5173/
   ```

3. On the other device, open `http://<laptop-ip>:5173`.

**Firewall (Fedora/Linux):** If the connection times out, open the port temporarily (survives sleep/suspend — cleared only on reboot or `--reload`):
```bash
sudo firewall-cmd --add-port=5173/tcp
```

Close it again when you're done sharing:
```bash
sudo firewall-cmd --remove-port=5173/tcp
```

> **Warning:** Avoid `--permanent` — it leaves the port open on all networks, including public Wi-Fi.

---

## How it works

| Layer | URL | Notes |
|---|---|---|
| React frontend | http://localhost:5173 | Vite dev server with hot reload |
| FastAPI backend | http://localhost:8000 | Auto-reloads on Python file changes |
| SQLite database | `job_tracker.db` (repo root) | Created automatically on first run |

All `/api/*` requests from the browser are proxied by Vite to the backend — no CORS issues during development.

---

## Verify it's working

1. Open http://localhost:5173 — you should see the Dashboard.
2. Click **New Application** and log a test entry.
3. It should appear on the **In Progress** page with status `applied`.
4. *(Optional)* Go to **New Application**, paste a job URL, and click **Extract** — requires `ANTHROPIC_API_KEY`.
