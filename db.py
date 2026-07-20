import sqlite3
import os
import json
import pandas as pd
from datetime import date, datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "job_tracker.db")
BACKUP_DIR = os.path.expanduser("~/.job_tracker_backups")
_MAX_BACKUPS = 10


def backup_db():
    """Copy DB to ~/.job_tracker_backups/ after every write, keep last 10, make read-only."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_path = os.path.join(BACKUP_DIR, f"job_tracker_{timestamp}.db")
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(backup_path)
    src.backup(dst)
    dst.close()
    src.close()
    os.chmod(backup_path, 0o444)
    # prune oldest beyond _MAX_BACKUPS
    files = sorted(
        [f for f in os.listdir(BACKUP_DIR) if f.startswith("job_tracker_") and f.endswith(".db")],
        reverse=True,
    )
    for old in files[_MAX_BACKUPS:]:
        old_path = os.path.join(BACKUP_DIR, old)
        os.chmod(old_path, 0o644)
        os.remove(old_path)

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

JOB_TYPES = [
    "Data Scientist", "Data Science Engineer", "ML Engineer", "AI Engineer",
    "Data Engineer", "Analytics Engineer", "GenAI/LLM Engineer", "Other",
]
JOB_SOURCES = ["Company Site", "LinkedIn", "Indeed", "Glassdoor", "Referral", "Handshake", "Other"]
JOB_STATUSES = ["applied", "interviewing", "offer", "declined", "inactive"]
COMM_PLATFORMS = ["Email", "Phone", "LinkedIn", "Text", "Video Call", "Other"]
COMM_DIRECTIONS = ["inbound", "outbound"]


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS job_applications (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            company         TEXT NOT NULL,
            org_team        TEXT,
            job_title       TEXT NOT NULL,
            job_type        TEXT,
            date_posted     TEXT,
            date_applied    TEXT,
            city            TEXT,
            state           TEXT,
            remote          INTEGER DEFAULT 0,
            salary_min      INTEGER,
            salary_max      INTEGER,
            salary_currency TEXT DEFAULT 'USD',
            job_link        TEXT,
            job_source      TEXT,
            status          TEXT DEFAULT 'applied',
            notes           TEXT,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS todo_applications (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            company         TEXT,
            org_team        TEXT,
            job_title       TEXT,
            job_type        TEXT,
            city            TEXT,
            state           TEXT,
            remote          INTEGER DEFAULT 0,
            salary_min      INTEGER,
            salary_max      INTEGER,
            salary_currency TEXT DEFAULT 'USD',
            job_link        TEXT,
            job_source      TEXT,
            notes           TEXT,
            extracted_by_ai INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS scraper_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            url           TEXT NOT NULL,
            method        TEXT,
            success       INTEGER DEFAULT 0,
            latency_ms    INTEGER,
            error_message TEXT,
            timestamp     TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL DEFAULT 'Untitled',
            content    TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS communications (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER NOT NULL,
            contact_name   TEXT,
            platform       TEXT,
            direction      TEXT,
            comm_date      TEXT,
            note           TEXT,
            follow_up_date TEXT,
            created_at     TEXT DEFAULT (datetime('now')),
            updated_at     TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS resumes (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            date          TEXT,
            description   TEXT,
            filename      TEXT NOT NULL,
            original_name TEXT,
            created_at    TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS discovered_jobs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            hc_id           TEXT UNIQUE NOT NULL,
            company         TEXT,
            job_title       TEXT,
            job_type        TEXT,
            locations       TEXT,
            work_arrangement TEXT,
            salary_min      INTEGER,
            salary_max      INTEGER,
            salary_currency TEXT DEFAULT 'USD',
            seniority_level TEXT,
            min_yoe         INTEGER,
            job_category    TEXT,
            job_link        TEXT,
            job_source      TEXT,
            summary         TEXT,
            raw_text        TEXT,
            date_posted     TEXT,
            search_query    TEXT,
            search_location TEXT,
            phase2_status   TEXT DEFAULT 'pending',
            phase2_error    TEXT,
            discovered_at   TEXT DEFAULT (datetime('now')),
            last_seen_at    TEXT DEFAULT (datetime('now')),
            dismissed       INTEGER DEFAULT 0
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS scrape_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at    TEXT DEFAULT (datetime('now')),
            finished_at   TEXT,
            status        TEXT DEFAULT 'running',
            total_combos  INTEGER DEFAULT 0,
            combos_done   INTEGER DEFAULT 0,
            jobs_found    INTEGER DEFAULT 0,
            jobs_new      INTEGER DEFAULT 0,
            jobs_enriched INTEGER DEFAULT 0,
            jobs_failed   INTEGER DEFAULT 0
        )
    """)

    # run_id ties each discovered job to the batch (scrape_run) that first found it —
    # set once at insert time, never reassigned, so a job belongs to exactly one batch.
    try:
        c.execute("ALTER TABLE discovered_jobs ADD COLUMN run_id INTEGER")
    except sqlite3.OperationalError:
        pass

    # User-defined tags (e.g. "eval") for filtering/organizing discovered jobs —
    # stored as a JSON array string, same convention as locations.
    try:
        c.execute("ALTER TABLE discovered_jobs ADD COLUMN tags TEXT DEFAULT '[]'")
    except sqlite3.OperationalError:
        pass

    # Add job_type to resumes if not present
    try:
        c.execute("ALTER TABLE resumes ADD COLUMN job_type TEXT")
    except sqlite3.OperationalError:
        pass

    # Add new columns if they don't exist (idempotent)
    for col_def in ["date_posted TEXT"]:
        try:
            c.execute(f"ALTER TABLE todo_applications ADD COLUMN {col_def}")
        except sqlite3.OperationalError:
            pass

    for table in ['job_applications', 'todo_applications']:
        for col_def in [
            "locations TEXT",
            "work_arrangement TEXT",
            "summary TEXT",
            "raw_text TEXT",
        ]:
            try:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
            except sqlite3.OperationalError:
                pass

    # Headhunter lead fields — job_applications only (not todo_applications)
    for col_def in [
        "is_headhunter_lead INTEGER DEFAULT 0",
        "recruiter_name TEXT",
        "recruiter_contact TEXT",
    ]:
        try:
            c.execute(f"ALTER TABLE job_applications ADD COLUMN {col_def}")
        except sqlite3.OperationalError:
            pass

    # Migrate existing city/state/remote → locations/work_arrangement
    for table in ['job_applications', 'todo_applications']:
        rows = c.execute(
            f"SELECT id, city, state, remote FROM {table} WHERE locations IS NULL"
        ).fetchall()
        for row in rows:
            city, state, remote_val = row['city'], row['state'], row['remote']
            locs = []
            if city or state:
                locs.append({"city": city, "state": state})
            work_arr = 'remote' if remote_val else None
            c.execute(
                f"UPDATE {table} SET locations=?, work_arrangement=? WHERE id=?",
                (json.dumps(locs), work_arr, row['id']),
            )

    conn.commit()
    conn.close()


# ── job_applications ──────────────────────────────────────────────────────────

def get_job_applications(status_filter=None) -> pd.DataFrame:
    conn = get_conn()
    if status_filter and isinstance(status_filter, list):
        placeholders = ",".join("?" * len(status_filter))
        df = pd.read_sql_query(
            f"SELECT * FROM job_applications WHERE status IN ({placeholders}) ORDER BY date_applied DESC",
            conn, params=status_filter,
        )
    elif status_filter:
        df = pd.read_sql_query(
            "SELECT * FROM job_applications WHERE status=? ORDER BY date_applied DESC",
            conn, params=(status_filter,),
        )
    else:
        df = pd.read_sql_query(
            "SELECT * FROM job_applications ORDER BY date_applied DESC", conn
        )
    conn.close()
    df['locations'] = df['locations'].apply(lambda x: json.loads(x) if isinstance(x, str) else [])
    return df


def insert_job_application(data: dict) -> int:
    locations = data.get("locations") or []
    conn = get_conn()
    cur = conn.execute("""
        INSERT INTO job_applications
            (company, org_team, job_title, job_type, date_posted, date_applied,
             locations, work_arrangement, salary_min, salary_max, salary_currency,
             job_link, job_source, status, notes, summary, raw_text,
             is_headhunter_lead, recruiter_name, recruiter_contact)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        data.get("company"), data.get("org_team"), data.get("job_title"),
        data.get("job_type"), data.get("date_posted"), data.get("date_applied"),
        json.dumps(locations), data.get("work_arrangement"),
        data.get("salary_min"), data.get("salary_max"),
        data.get("salary_currency", "USD"),
        data.get("job_link"), data.get("job_source"),
        data.get("status", "applied"), data.get("notes"),
        data.get("summary"), data.get("raw_text"),
        data.get("is_headhunter_lead", False), data.get("recruiter_name"), data.get("recruiter_contact"),
    ))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    backup_db()
    return new_id


def delete_job_application(app_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM communications WHERE application_id=?", (app_id,))
    conn.execute("DELETE FROM job_applications WHERE id=?", (app_id,))
    conn.commit()
    conn.close()
    backup_db()


def update_application_status(app_id: int, status: str):
    conn = get_conn()
    conn.execute(
        "UPDATE job_applications SET status=?, updated_at=datetime('now') WHERE id=?",
        (status, app_id),
    )
    conn.commit()
    conn.close()
    backup_db()


def update_job_application(app_id: int, data: dict):
    locations = data.get("locations") or []
    conn = get_conn()
    conn.execute("""
        UPDATE job_applications SET
            company=?, org_team=?, job_title=?, job_type=?,
            date_posted=?, date_applied=?, locations=?, work_arrangement=?,
            salary_min=?, salary_max=?, salary_currency=?,
            job_link=?, job_source=?, status=?, notes=?,
            summary=?, raw_text=?,
            is_headhunter_lead=?, recruiter_name=?, recruiter_contact=?,
            updated_at=datetime('now')
        WHERE id=?
    """, (
        data.get("company"), data.get("org_team"), data.get("job_title"),
        data.get("job_type"), data.get("date_posted"), data.get("date_applied"),
        json.dumps(locations), data.get("work_arrangement"),
        data.get("salary_min"), data.get("salary_max"),
        data.get("salary_currency", "USD"),
        data.get("job_link"), data.get("job_source"),
        data.get("status"), data.get("notes"),
        data.get("summary"), data.get("raw_text"),
        data.get("is_headhunter_lead", False), data.get("recruiter_name"), data.get("recruiter_contact"),
        app_id,
    ))
    conn.commit()
    conn.close()
    backup_db()


# ── todo_applications ─────────────────────────────────────────────────────────

def get_todo_applications() -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql_query(
        "SELECT * FROM todo_applications ORDER BY created_at DESC", conn
    )
    conn.close()
    df['locations'] = df['locations'].apply(lambda x: json.loads(x) if isinstance(x, str) else [])
    return df


def insert_todo_application(data: dict) -> int:
    locations = data.get("locations") or []
    conn = get_conn()
    cur = conn.execute("""
        INSERT INTO todo_applications
            (company, org_team, job_title, job_type, locations, work_arrangement,
             salary_min, salary_max, salary_currency, job_link, job_source,
             notes, summary, raw_text, extracted_by_ai, date_posted)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        data.get("company"), data.get("org_team"), data.get("job_title"),
        data.get("job_type"), json.dumps(locations), data.get("work_arrangement"),
        data.get("salary_min"), data.get("salary_max"),
        data.get("salary_currency", "USD"),
        data.get("job_link"), data.get("job_source"), data.get("notes"),
        data.get("summary"), data.get("raw_text"),
        1 if data.get("extracted_by_ai") else 0,
        data.get("date_posted") or None,
    ))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    backup_db()
    return new_id


def delete_todo_application(todo_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM todo_applications WHERE id=?", (todo_id,))
    conn.commit()
    conn.close()
    backup_db()


def move_todo_to_applied(todo_id: int, date_applied: str) -> int:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM todo_applications WHERE id=?", (todo_id,)
    ).fetchone()
    if not row:
        conn.close()
        return None
    d = dict(row)
    cur = conn.execute("""
        INSERT INTO job_applications
            (company, org_team, job_title, job_type, locations, work_arrangement,
             salary_min, salary_max, salary_currency, job_link, job_source,
             notes, summary, raw_text, date_applied, date_posted, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        d.get("company"), d.get("org_team"), d.get("job_title"),
        d.get("job_type"), d.get("locations", "[]"), d.get("work_arrangement"),
        d.get("salary_min"), d.get("salary_max"),
        d.get("salary_currency", "USD"),
        d.get("job_link"), d.get("job_source"), d.get("notes"),
        d.get("summary"), d.get("raw_text"),
        date_applied, d.get("date_posted"), "applied",
    ))
    new_id = cur.lastrowid
    conn.execute("DELETE FROM todo_applications WHERE id=?", (todo_id,))
    conn.commit()
    conn.close()
    backup_db()
    return new_id


# ── dedup helpers ────────────────────────────────────────────────────────────

def get_all_tracked_urls() -> set:
    """Return all job_link values from both job_applications and todo_applications."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT job_link FROM job_applications WHERE job_link IS NOT NULL "
        "UNION "
        "SELECT job_link FROM todo_applications WHERE job_link IS NOT NULL"
    ).fetchall()
    conn.close()
    return {row["job_link"] for row in rows}


# ── discovered_jobs / scrape_runs ───────────────────────────────────────────────

def upsert_discovered_job(data: dict, run_id: int = None) -> int:
    """
    Insert a newly discovered job tagged with the batch (run_id) that found it,
    or — if this hc_id already exists from an earlier batch — just refresh
    last_seen_at. run_id is never reassigned on an existing row, so each job
    belongs to exactly one batch and never appears duplicated across batches.
    """
    locations = data.get("locations") or []
    conn = get_conn()
    existing = conn.execute(
        "SELECT id FROM discovered_jobs WHERE hc_id=?", (data["hc_id"],)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE discovered_jobs SET last_seen_at=datetime('now') WHERE id=?",
            (existing["id"],),
        )
        conn.commit()
        new_id = existing["id"]
    else:
        cur = conn.execute("""
            INSERT INTO discovered_jobs
                (hc_id, company, job_title, job_type, locations, work_arrangement,
                 salary_min, salary_max, salary_currency, seniority_level, min_yoe,
                 job_category, job_link, job_source, summary, raw_text, date_posted,
                 search_query, search_location, phase2_status, run_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            data["hc_id"], data.get("company"), data.get("job_title"), data.get("job_type"),
            json.dumps(locations), data.get("work_arrangement"),
            data.get("salary_min"), data.get("salary_max"), data.get("salary_currency", "USD"),
            data.get("seniority_level"), data.get("min_yoe"), data.get("job_category"),
            data.get("job_link"), data.get("job_source"), data.get("summary"), data.get("raw_text"),
            data.get("date_posted"), data.get("search_query"), data.get("search_location"),
            data.get("phase2_status", "pending"), run_id,
        ))
        conn.commit()
        new_id = cur.lastrowid
    conn.close()
    return new_id


def update_discovered_job_enrichment(job_id: int, data: dict, phase2_status: str, phase2_error: str = None):
    conn = get_conn()
    conn.execute("""
        UPDATE discovered_jobs SET
            salary_min=COALESCE(?, salary_min), salary_max=COALESCE(?, salary_max),
            summary=COALESCE(?, summary), raw_text=COALESCE(?, raw_text),
            phase2_status=?, phase2_error=?
        WHERE id=?
    """, (
        data.get("salary_min"), data.get("salary_max"), data.get("summary"), data.get("raw_text"),
        phase2_status, phase2_error, job_id,
    ))
    conn.commit()
    conn.close()


def get_discovered_jobs(include_dismissed: bool = False) -> pd.DataFrame:
    conn = get_conn()
    where = "" if include_dismissed else "WHERE dismissed=0"
    df = pd.read_sql_query(
        f"SELECT * FROM discovered_jobs {where} ORDER BY discovered_at DESC", conn
    )
    conn.close()
    if not df.empty:
        df['locations'] = df['locations'].apply(lambda x: json.loads(x) if isinstance(x, str) else [])
        df['tags'] = df['tags'].apply(lambda x: json.loads(x) if isinstance(x, str) else [])
    return df


def dismiss_discovered_job(job_id: int):
    conn = get_conn()
    conn.execute("UPDATE discovered_jobs SET dismissed=1 WHERE id=?", (job_id,))
    conn.commit()
    conn.close()


def update_discovered_job_tags(job_id: int, tags: list[str]) -> None:
    conn = get_conn()
    conn.execute(
        "UPDATE discovered_jobs SET tags=? WHERE id=?", (json.dumps(tags), job_id)
    )
    conn.commit()
    conn.close()


def get_discovered_job(job_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM discovered_jobs WHERE id=?", (job_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d['locations'] = json.loads(d['locations']) if d.get('locations') else []
    d['tags'] = json.loads(d['tags']) if d.get('tags') else []
    return d


def create_scrape_run(total_combos: int) -> int:
    conn = get_conn()
    # A prior run stuck in 'running' means the server restarted/crashed mid-run —
    # it'll never update itself again, so relabel it rather than let it linger forever.
    conn.execute(
        "UPDATE scrape_runs SET status='interrupted', finished_at=datetime('now') WHERE status='running'"
    )
    cur = conn.execute(
        "INSERT INTO scrape_runs (total_combos, status) VALUES (?, 'running')",
        (total_combos,),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def update_scrape_run(run_id: int, **fields):
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    conn = get_conn()
    conn.execute(
        f"UPDATE scrape_runs SET {cols} WHERE id=?",
        (*fields.values(), run_id),
    )
    conn.commit()
    conn.close()


def finish_scrape_run(run_id: int, status: str = "done"):
    conn = get_conn()
    conn.execute(
        "UPDATE scrape_runs SET status=?, finished_at=datetime('now') WHERE id=?",
        (status, run_id),
    )
    conn.commit()
    conn.close()


def get_scrape_runs() -> list[dict]:
    """All runs (batches), most recent first — for the batch history/filter."""
    conn = get_conn()
    rows = conn.execute("SELECT * FROM scrape_runs ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_latest_scrape_run() -> dict | None:
    runs = get_scrape_runs()
    return runs[0] if runs else None


# ── scraper_log ───────────────────────────────────────────────────────────────

def insert_scraper_log(url: str, method: str, success: bool, latency_ms: int, error: str = None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO scraper_log (url, method, success, latency_ms, error_message) VALUES (?,?,?,?,?)",
        (url, method, 1 if success else 0, latency_ms, error),
    )
    conn.commit()
    conn.close()


def get_scraper_logs() -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql_query(
        "SELECT * FROM scraper_log ORDER BY timestamp DESC", conn
    )
    conn.close()
    return df


# ── notes ─────────────────────────────────────────────────────────────────────

def get_notes() -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, title, updated_at FROM notes ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_note(note_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_note(title: str) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO notes (title, content) VALUES (?, '')", (title,)
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def update_note(note_id: int, title: str, content: str):
    conn = get_conn()
    conn.execute(
        "UPDATE notes SET title=?, content=?, updated_at=datetime('now') WHERE id=?",
        (title, content, note_id),
    )
    conn.commit()
    conn.close()


def delete_note(note_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.commit()
    conn.close()


# ── communications ────────────────────────────────────────────────────────────

def get_communications(application_id: int) -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM communications WHERE application_id=? ORDER BY comm_date DESC, id DESC",
        (application_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_communication(data: dict) -> int:
    conn = get_conn()
    cur = conn.execute("""
        INSERT INTO communications
            (application_id, contact_name, platform, direction, comm_date, note, follow_up_date)
        VALUES (?,?,?,?,?,?,?)
    """, (
        data.get("application_id"), data.get("contact_name"), data.get("platform"),
        data.get("direction"), data.get("comm_date"), data.get("note"),
        data.get("follow_up_date"),
    ))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def delete_communication(comm_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM communications WHERE id=?", (comm_id,))
    conn.commit()
    conn.close()


def get_upcoming_followups() -> list:
    conn = get_conn()
    rows = conn.execute("""
        SELECT c.id, c.application_id, c.follow_up_date, c.contact_name, c.platform,
               j.company, j.job_title
        FROM communications c
        JOIN job_applications j ON j.id = c.application_id
        WHERE c.follow_up_date IS NOT NULL AND c.follow_up_date != ''
          AND date(c.follow_up_date) <= date('now', '+7 days')
        ORDER BY c.follow_up_date ASC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── resumes ───────────────────────────────────────────────────────────────────

def list_resumes() -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM resumes ORDER BY date DESC, created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def insert_resume(name: str, date: str, description: str, filename: str, original_name: str, job_type: str = None) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO resumes (name, date, description, filename, original_name, job_type) VALUES (?,?,?,?,?,?)",
        (name, date or None, description or None, filename, original_name, job_type or None),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def get_resume(resume_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM resumes WHERE id=?", (resume_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_resume(resume_id: int) -> str | None:
    conn = get_conn()
    row = conn.execute("SELECT filename FROM resumes WHERE id=?", (resume_id,)).fetchone()
    if not row:
        conn.close()
        return None
    filename = row["filename"]
    conn.execute("DELETE FROM resumes WHERE id=?", (resume_id,))
    conn.commit()
    conn.close()
    return filename


init_db()
