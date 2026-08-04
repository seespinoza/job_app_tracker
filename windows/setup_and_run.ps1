<#
    Job Tracker — Windows setup & run

    What this does, every time you run it:
      1. Checks for Python 3.11+ and Node.js 18+, installing them via winget if missing.
      2. Creates/updates the Python virtual environment (.venv) and installs dependencies.
      3. Asks once for an optional Anthropic API key (only needed for AI auto-fill; skip freely).
      4. Installs frontend dependencies (npm install).
      5. Starts the backend and frontend, each in their own window, and opens your browser.

    Safe to run again any time — it skips whatever's already done and just starts the app.

    HOW TO RUN THIS:
      Easiest: double-click "setup_and_run.bat" in this same folder (handles the PowerShell
      execution-policy prompt for you).

      Or, from a PowerShell window:
          cd path\to\job_app_tracker\windows
          powershell -ExecutionPolicy Bypass -File .\setup_and_run.ps1
#>

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "    $msg" -ForegroundColor Red }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Update-PathFromRegistry {
    # winget-installed tools register PATH updates in the registry, but this already-running
    # process won't see them until we re-read Machine + User PATH ourselves.
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Require-Winget {
    if (-not (Test-Command 'winget')) {
        Write-Err2 "winget isn't available on this machine."
        Write-Err2 "Install 'App Installer' from the Microsoft Store, then re-run this script:"
        Write-Err2 "  https://apps.microsoft.com/detail/9nblggh4nns1"
        exit 1
    }
}

# ── Python ──────────────────────────────────────────────────────────────────
Write-Step "Checking for Python 3.11+"

function Find-Python311Plus {
    foreach ($cand in @('python', 'py')) {
        if (Test-Command $cand) {
            try {
                $verStr = (& $cand --version) 2>&1
                if ($verStr -match '(\d+)\.(\d+)') {
                    $maj = [int]$Matches[1]; $min = [int]$Matches[2]
                    if ($maj -gt 3 -or ($maj -eq 3 -and $min -ge 11)) { return $cand }
                }
            } catch {}
        }
    }
    return $null
}

$python = Find-Python311Plus
if (-not $python) {
    Write-Warn2 "Python 3.11+ not found — installing via winget (this can take a few minutes)…"
    Require-Winget
    winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
    Update-PathFromRegistry
    $python = Find-Python311Plus
    if (-not $python) {
        Write-Warn2 "Python was just installed but isn't visible in this window yet."
        Write-Warn2 "Close this window, reopen '$($MyInvocation.MyCommand.Name)', and run it again."
        exit 1
    }
}
Write-Ok "Using $((& $python --version))"

# ── Node.js ─────────────────────────────────────────────────────────────────
Write-Step "Checking for Node.js 18+"

$nodeOk = $false
if (Test-Command 'node') {
    $verStr = (& node --version) -replace 'v', ''
    $maj = [int]($verStr.Split('.')[0])
    if ($maj -ge 18) { $nodeOk = $true }
}
if (-not $nodeOk) {
    Write-Warn2 "Node.js 18+ not found — installing via winget (this can take a few minutes)…"
    Require-Winget
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    Update-PathFromRegistry
    if (-not (Test-Command 'node')) {
        Write-Warn2 "Node.js was just installed but isn't visible in this window yet."
        Write-Warn2 "Close this window, reopen '$($MyInvocation.MyCommand.Name)', and run it again."
        exit 1
    }
}
Write-Ok "Using node $((& node --version))"

# ── Python virtual environment ────────────────────────────────────────────
Write-Step "Setting up the Python virtual environment"

if (-not (Test-Path ".venv")) {
    & $python -m venv .venv
    Write-Ok "Created .venv"
} else {
    Write-Ok ".venv already exists"
}

$venvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet -r requirements.txt
Write-Ok "Python dependencies installed"

# ── Optional Playwright browser (fallback scraper) ─────────────────────────
Write-Step "Optional: Playwright browser (fallback scraper for sites that block the primary fetcher)"

$playwrightMarker = Join-Path $RepoRoot ".venv\.playwright_chromium_installed"
if (Test-Path $playwrightMarker) {
    Write-Ok "Already installed — skipping"
} else {
    $installBrowser = Read-Host "Install it now? Not required — the app works without it. (~150 MB, y/N)"
    if ($installBrowser -match '^[Yy]') {
        & $venvPython -m playwright install chromium
        New-Item -Path $playwrightMarker -ItemType File -Force | Out-Null
        Write-Ok "Playwright browser installed"
    } else {
        Write-Ok "Skipped — you can install it later with: .venv\Scripts\python.exe -m playwright install chromium"
    }
}

# ── .env / ANTHROPIC_API_KEY ────────────────────────────────────────────────
Write-Step "Checking for a .env file"

if (-not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "This app can optionally use an Anthropic API key to auto-fill job details from a pasted URL."
    Write-Host "Everything else works fine without one — feel free to just press Enter to skip."
    $key = Read-Host "Paste your ANTHROPIC_API_KEY (or press Enter to skip)"
    if ($key) {
        "ANTHROPIC_API_KEY=$key" | Out-File -FilePath ".env" -Encoding utf8 -NoNewline
        Write-Ok "Saved .env"
    } else {
        "# ANTHROPIC_API_KEY=sk-ant-..." | Out-File -FilePath ".env" -Encoding utf8 -NoNewline
        Write-Ok "Skipped — created a placeholder .env (add ANTHROPIC_API_KEY later any time you want AI auto-fill)"
    }
} else {
    Write-Ok ".env already exists — leaving it as-is"
}

# ── Frontend dependencies ───────────────────────────────────────────────────
Write-Step "Installing frontend dependencies (npm install)"

Push-Location frontend
npm install --no-fund --no-audit
Pop-Location
Write-Ok "Frontend dependencies installed"

# ── Launch ───────────────────────────────────────────────────────────────────
Write-Step "Starting the app"

function Test-PortOpen($port) {
    try {
        return (Test-NetConnection -ComputerName 'localhost' -Port $port -WarningAction SilentlyContinue -InformationLevel Quiet)
    } catch {
        return $false
    }
}

if (Test-PortOpen 8000) {
    Write-Ok "Backend already running on port 8000"
} else {
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "cd '$RepoRoot'; .\.venv\Scripts\uvicorn.exe api:app --reload --host 0.0.0.0"
    )
    Write-Ok "Backend starting in a new window (http://localhost:8000)"
}

if (Test-PortOpen 5173) {
    Write-Ok "Frontend already running on port 5173"
} else {
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "cd '$RepoRoot\frontend'; npm run dev"
    )
    Write-Ok "Frontend starting in a new window (http://localhost:5173)"
}

Write-Step "Waiting for the app to come up"

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-PortOpen 5173) { $ready = $true; break }
}

if ($ready) {
    Start-Process "http://localhost:5173"
    Write-Ok "Opened http://localhost:5173 in your browser"
} else {
    Write-Warn2 "The frontend didn't come up within 30 seconds — check the two new PowerShell windows for errors."
}

Write-Host ""
Write-Host "Two windows are now running the app (backend + frontend) — keep them open while you use it."
Write-Host "Close them, or press Ctrl+C in each, to stop the app. Run this script again any time to restart it."
