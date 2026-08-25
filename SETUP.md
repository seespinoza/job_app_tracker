# Install Guide

Works on Windows 11, macOS, and Linux. Pick your OS in each step below.

**Windows users who don't want to touch a terminal:** skip this whole guide and just double-click [`windows/setup_and_run.bat`](windows/setup_and_run.bat) — it does everything below automatically (installs Python/Node if missing, sets up the app, and launches it). Come back here only if you want to understand what it's doing, or if something goes wrong.

---

## 1. Prerequisites

- **Python 3.11+**
- **Node.js 18+** (includes npm)
- **git**

<details>
<summary><b>Windows</b></summary>

Easiest: install both via [winget](https://apps.microsoft.com/detail/9nblggh4nns1) (built into Windows 11) from PowerShell:

```powershell
winget install --id Python.Python.3.12 -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Or download installers manually: [python.org](https://www.python.org/downloads/) (check "Add python.exe to PATH" during install), [nodejs.org](https://nodejs.org/) (LTS build), [git-scm.com](https://git-scm.com/download/win).

Close and reopen PowerShell after installing so it picks up the updated PATH.

</details>

<details>
<summary><b>macOS</b></summary>

```bash
brew install python@3.12 node git
```

Don't have Homebrew? Install it from [brew.sh](https://brew.sh/) first.

</details>

<details>
<summary><b>Linux (Fedora)</b></summary>

```bash
sudo dnf install python3.12 nodejs git
```

Other distros: use your package manager (`apt`, `pacman`, etc.) — package names are usually the same or close.

</details>

---

## 2. Clone the repo

Identical on every OS:

```bash
git clone <repo-url>
cd job_app_tracker
```

---

## 3. Python environment

<details open>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

</details>

<details>
<summary><b>macOS / Linux</b></summary>

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

</details>

> **Windows note:** `requirements.txt` pulls in `uvicorn[standard]`, which normally includes `uvloop` for a faster event loop. `uvloop` has no Windows build, so pip skips it automatically and uvicorn falls back to Python's standard asyncio loop — this is expected, not an error, and doesn't affect functionality (just a minor perf profile difference vs. Linux/Mac).

---

## 4. Environment variables

Create a `.env` file in the project root (same on every OS):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key from https://console.anthropic.com/keys.

> This is **optional**. It only enables AI auto-fill (pasting a job URL/text and having it extract structured fields). Everything else works without it — feel free to skip this step and add the key later.

---

## 5. Playwright browser (optional)

Only needed as a fallback scraper for job sites that block the primary fetcher (Jina Reader). Same command on every OS — it downloads a native browser build for your platform automatically:

```bash
playwright install chromium
```

(~150 MB download; skip this and add it later if you're not sure you need it.)

---

## 6. Frontend dependencies

Identical on every OS:

```bash
cd frontend
npm install
cd ..
```

---

## 7. Run the app

Open two terminals from the project root.

<details open>
<summary><b>Windows (PowerShell)</b></summary>

**Terminal 1 — backend:**
```powershell
.venv\Scripts\activate
.venv\Scripts\uvicorn.exe api:app --reload --host 0.0.0.0
```

**Terminal 2 — frontend:**
```powershell
cd frontend
npm run dev
```

</details>

<details>
<summary><b>macOS / Linux</b></summary>

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

</details>

Open http://localhost:5173 in your browser.

---

## 8. Accessing from another device on the same network

Both servers listen on all network interfaces, so any device on the same Wi-Fi/LAN can reach the app.

**Find your machine's local IP:**

| OS | Command |
|---|---|
| Windows | `ipconfig` (look for "IPv4 Address" under your active adapter) |
| macOS/Linux | `hostname -I` (or check the "Network:" line Vite prints on startup) |

Then on the other device, open `http://<your-ip>:5173`.

**Firewall — open the ports temporarily:**

<details open>
<summary><b>Windows</b></summary>

Windows Defender Firewall will usually prompt you the first time each server starts — click "Allow" for both Private and Public (if on a trusted network) when asked. If it doesn't prompt, or you closed the prompt, run this once from an elevated (Run as Administrator) PowerShell:

```powershell
netsh advfirewall firewall add rule name="JobTracker" dir=in action=allow protocol=TCP localport=5173,8000
```

To remove it later:
```powershell
netsh advfirewall firewall delete rule name="JobTracker"
```

</details>

<details>
<summary><b>Linux (Fedora)</b></summary>

```bash
sudo firewall-cmd --add-port=5173/tcp
```

Close it again when done sharing (this survives sleep/suspend, cleared only on reboot or the next `--reload`):
```bash
sudo firewall-cmd --remove-port=5173/tcp
```

</details>

<details>
<summary><b>macOS</b></summary>

macOS will prompt "Do you want the application to accept incoming connections?" the first time each server starts — click **Allow**.

</details>

> **Warning:** Don't use `--permanent` firewall rules for this — they leave the port open on all networks, including public Wi-Fi. Open temporarily, close when done.

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
5. Check that a backup appeared:
   - Windows: `%USERPROFILE%\.job_tracker_backups\`
   - macOS/Linux: `~/.job_tracker_backups/`

   Every write creates a timestamped, read-only copy there automatically (last 10 kept) — this is your safety net against accidental data loss and should never be edited manually.

---

## Troubleshooting

<details>
<summary><b>Windows: "running scripts is disabled on this system" when activating the venv</b></summary>

PowerShell's default execution policy blocks script activation. Either use the `.bat` launcher (`windows/setup_and_run.bat`), which bypasses this for its own run only, or allow scripts for your user account once:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

</details>

<details>
<summary><b>Windows: "python"/"node" not recognized after installing</b></summary>

Close and reopen your terminal — a freshly installed program's PATH entry isn't picked up by windows already open when it was installed.

</details>

<details>
<summary><b>macOS: Gatekeeper blocks Playwright's Chromium on first launch</b></summary>

Go to **System Settings → Privacy & Security** and click **Allow Anyway** next to the blocked-app notice, then retry.

</details>

<details>
<summary><b>Linux: Playwright's Chromium fails to launch, missing shared libraries</b></summary>

Install the OS-level dependencies Playwright needs:
```bash
playwright install-deps chromium
```

</details>
