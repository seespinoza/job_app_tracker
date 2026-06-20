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

JOB_TYPES = ["Data Scientist", "ML Engineer", "AI Engineer", "Data Engineer", "Other"]
JOB_SOURCES = ["Company Site", "LinkedIn", "Indeed", "Glassdoor", "Referral", "Handshake", "Other"]
JOB_STATUSES = ["applied", "interviewing", "offer", "declined", "inactive"]


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
             job_link, job_source, status, notes, summary, raw_text)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        data.get("company"), data.get("org_team"), data.get("job_title"),
        data.get("job_type"), data.get("date_posted"), data.get("date_applied"),
        json.dumps(locations), data.get("work_arrangement"),
        data.get("salary_min"), data.get("salary_max"),
        data.get("salary_currency", "USD"),
        data.get("job_link"), data.get("job_source"),
        data.get("status", "applied"), data.get("notes"),
        data.get("summary"), data.get("raw_text"),
    ))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    backup_db()
    return new_id


def delete_job_application(app_id: int):
    conn = get_conn()
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
