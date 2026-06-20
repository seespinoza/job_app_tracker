"""
One-shot script: extract requirements/responsibilities/preferred from raw_text
via Claude Haiku, store in new DB columns, then regenerate all job_cards/*.md.

Run from repo root:
    .venv/bin/python backfill_job_sections.py
"""

import os
import re
import sys
import json
import time
import sqlite3

DB = "job_tracker.db"
OUT_DIR = "job_cards"
HAIKU_MODEL = "claude-haiku-4-5-20251001"

SECTIONS_PROMPT = """\
Extract structured content from the following job posting text.
Return ONLY a valid JSON object with exactly these three fields (each a list of strings):
{
  "responsibilities": ["bullet item", ...],
  "requirements": ["bullet item", ...],
  "preferred": ["bullet item", ...]
}

Guidelines:
- "responsibilities": what the person will DO day-to-day (duties, tasks)
- "requirements": hard/minimum qualifications (must-haves, years of experience, degrees)
- "preferred": nice-to-haves, bonus, or preferred qualifications
- Each item should be a single concise bullet (1-2 sentences max)
- Use an empty list [] if a section is not present in the posting
- Do NOT include any explanation outside the JSON

Job posting text:
"""


def _extract_json(raw: str) -> dict:
    if "```" in raw:
        for block in raw.split("```")[1::2]:
            candidate = block.lstrip("json").strip()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r'\{[\s\S]*\}', raw)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    raise ValueError(f"No valid JSON in response: {raw[:300]!r}")


def extract_sections(raw_text: str) -> dict:
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": SECTIONS_PROMPT + raw_text[:20000]}],
    )
    data = _extract_json(msg.content[0].text.strip())
    for key in ("responsibilities", "requirements", "preferred"):
        if not isinstance(data.get(key), list):
            data[key] = []
    return data


# ── DB migration ──────────────────────────────────────────────────────────────

def add_columns(conn):
    cur = conn.cursor()
    for col in ("responsibilities", "requirements", "preferred"):
        try:
            cur.execute(f"ALTER TABLE job_applications ADD COLUMN {col} TEXT")
        except sqlite3.OperationalError:
            pass  # already exists
    conn.commit()


# ── Markdown generation ───────────────────────────────────────────────────────

def safe_filename(company, title, id_):
    raw = f"{id_:03d} - {company} - {title}"
    return re.sub(r'[<>:"/\\|?*]', '', raw).strip() + ".md"


def fmt_salary(lo, hi, currency):
    if lo and hi:
        return f"${lo:,} – ${hi:,} {currency}"
    if lo:
        return f"${lo:,}+ {currency}"
    if hi:
        return f"up to ${hi:,} {currency}"
    return "Not disclosed"


def fmt_locations(loc_json):
    if not loc_json:
        return "Not specified"
    try:
        locs = json.loads(loc_json)
        return ", ".join(
            f"{l.get('city','')}, {l.get('state','')}".strip(", ") for l in locs
        )
    except Exception:
        return loc_json


def status_tag(status):
    return f"#status/{status}" if status else ""


def type_tag(jtype):
    return "#type/" + jtype.lower().replace(" ", "-") if jtype else ""


def bullet_section(header: str, items_json) -> list[str]:
    if not items_json:
        return []
    try:
        items = json.loads(items_json) if isinstance(items_json, str) else items_json
    except Exception:
        return []
    if not items:
        return []
    lines = [f"## {header}", ""]
    for item in items:
        lines.append(f"- {item}")
    lines.append("")
    return lines


def write_card(r: dict, out_dir: str):
    filename = safe_filename(r["company"], r["job_title"], r["id"])
    filepath = os.path.join(out_dir, filename)

    tags = [t for t in [status_tag(r["status"]), type_tag(r["job_type"])] if t]

    lines = ["---"]
    lines.append(f'id: {r["id"]}')
    lines.append(f'company: "{r["company"]}"')
    if r["org_team"]:
        lines.append(f'team: "{r["org_team"]}"')
    lines.append(f'title: "{r["job_title"]}"')
    lines.append(f'type: "{r["job_type"] or ""}"')
    lines.append(f'status: {r["status"]}')
    lines.append(f'work_arrangement: {r["work_arrangement"] or "unknown"}')
    lines.append(f'date_posted: {r["date_posted"] or ""}')
    lines.append(f'date_applied: {r["date_applied"] or ""}')
    lines.append(f'locations: "{fmt_locations(r["locations"])}"')
    lines.append(f'salary: "{fmt_salary(r["salary_min"], r["salary_max"], r["salary_currency"])}"')
    lines.append(f'source: "{r["job_source"] or ""}"')
    if r["job_link"]:
        lines.append(f'job_link: "{r["job_link"]}"')
    lines.append(f'tags: [{", ".join(tags)}]')
    lines.append(f'created_at: {r["created_at"]}')
    lines.append(f'updated_at: {r["updated_at"]}')
    lines.append("---")
    lines.append("")

    lines.append(f'# {r["job_title"]} — {r["company"]}')
    lines.append("")

    lines.append("## Overview")
    lines.append("")
    lines.append("| Field | Value |")
    lines.append("|-------|-------|")
    lines.append(f'| **Company** | {r["company"]} |')
    if r["org_team"]:
        lines.append(f'| **Team / Org** | {r["org_team"]} |')
    lines.append(f'| **Role Type** | {r["job_type"] or "—"} |')
    lines.append(f'| **Status** | {r["status"].capitalize()} |')
    lines.append(f'| **Work Arrangement** | {(r["work_arrangement"] or "—").capitalize()} |')
    lines.append(f'| **Location(s)** | {fmt_locations(r["locations"])} |')
    lines.append(f'| **Salary** | {fmt_salary(r["salary_min"], r["salary_max"], r["salary_currency"])} |')
    lines.append(f'| **Date Posted** | {r["date_posted"] or "—"} |')
    lines.append(f'| **Date Applied** | {r["date_applied"] or "—"} |')
    lines.append(f'| **Source** | {r["job_source"] or "—"} |')
    if r["job_link"]:
        lines.append(f'| **Job Link** | [View Posting]({r["job_link"]}) |')
    lines.append("")

    if r["summary"]:
        lines.append("## Summary")
        lines.append("")
        lines.append(r["summary"])
        lines.append("")

    lines += bullet_section("Responsibilities", r.get("responsibilities"))
    lines += bullet_section("Requirements", r.get("requirements"))
    lines += bullet_section("Preferred Qualifications", r.get("preferred"))

    if r["notes"]:
        lines.append("## Notes")
        lines.append("")
        lines.append(r["notes"])
        lines.append("")

    lines.append("## Journal")
    lines.append("")
    lines.append("_Add interview notes, follow-ups, and reflections here._")
    lines.append("")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return filename


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    add_columns(conn)

    cur = conn.cursor()
    cur.execute("""
        SELECT id, raw_text FROM job_applications
        WHERE raw_text IS NOT NULL AND raw_text != ''
          AND (responsibilities IS NULL OR requirements IS NULL OR preferred IS NULL)
        ORDER BY id
    """)
    to_extract = cur.fetchall()

    if to_extract:
        print(f"Extracting sections for {len(to_extract)} records via Claude Haiku...")
        for row in to_extract:
            id_ = row["id"]
            print(f"  [{id_}] extracting...", end=" ", flush=True)
            try:
                t0 = time.time()
                sections = extract_sections(row["raw_text"])
                elapsed = int((time.time() - t0) * 1000)
                conn.execute("""
                    UPDATE job_applications
                    SET responsibilities = ?, requirements = ?, preferred = ?
                    WHERE id = ?
                """, (
                    json.dumps(sections["responsibilities"]),
                    json.dumps(sections["requirements"]),
                    json.dumps(sections["preferred"]),
                    id_,
                ))
                conn.commit()
                print(f"ok ({elapsed}ms, {len(sections['responsibilities'])} resp / {len(sections['requirements'])} req / {len(sections['preferred'])} pref)")
            except Exception as e:
                print(f"FAILED: {e}")
    else:
        print("All records already have sections extracted — skipping API calls.")

    # Regenerate all cards
    cur.execute("""
        SELECT id, company, org_team, job_title, job_type, date_posted, date_applied,
               locations, work_arrangement, salary_min, salary_max, salary_currency,
               job_link, job_source, status, notes, summary,
               responsibilities, requirements, preferred,
               created_at, updated_at
        FROM job_applications ORDER BY id
    """)
    rows = cur.fetchall()
    conn.close()

    print(f"\nRegenerating {len(rows)} markdown cards...")
    for row in rows:
        fname = write_card(dict(row), OUT_DIR)
        print(f"  wrote: {fname}")

    print(f"\nDone.")


if __name__ == "__main__":
    main()
