"""One-shot backfill: fetch raw_text via Jina for job_applications missing it."""
import os
import sqlite3
import httpx
import time

DB_PATH = "job_tracker.db"
JINA_BASE = "https://r.jina.ai/"
RAW_TEXT_MAX = 80_000


def _jina_key() -> str | None:
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT value FROM app_settings WHERE key='jina_api_key'").fetchone()
        conn.close()
        if row and row[0]:
            return row[0].strip()
    except Exception:
        pass
    return (os.environ.get("JINA_API_KEY") or "").strip() or None


def fetch_via_jina(url: str) -> str | None:
    try:
        headers = {"Accept": "text/plain", "X-Return-Format": "text"}
        key = _jina_key()
        if key:
            headers["Authorization"] = f"Bearer {key}"
        resp = httpx.get(
            f"{JINA_BASE}{url}",
            timeout=30,
            headers=headers,
            follow_redirects=True,
        )
        if resp.status_code == 200 and len(resp.text.strip()) > 100:
            return resp.text[:RAW_TEXT_MAX]
        print(f"  Jina returned HTTP {resp.status_code} or empty body")
    except Exception as e:
        print(f"  Jina error: {e}")
    return None

def main():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, company, job_title, job_link FROM job_applications WHERE raw_text IS NULL AND job_link IS NOT NULL"
    ).fetchall()

    if not rows:
        print("No applications need backfill.")
        return

    for app_id, company, title, link in rows:
        print(f"[{app_id}] {company} — {title}")
        print(f"  URL: {link}")
        text = fetch_via_jina(link)
        if text:
            conn.execute("UPDATE job_applications SET raw_text=? WHERE id=?", (text, app_id))
            conn.commit()
            print(f"  Saved {len(text):,} chars")
        else:
            print(f"  Failed — raw_text left empty")
        time.sleep(1)

    conn.close()
    print("Done.")

if __name__ == "__main__":
    main()
