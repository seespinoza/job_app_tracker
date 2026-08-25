import os
import re
import time
import json
import httpx
from datetime import date, timedelta

JINA_BASE = "https://r.jina.ai/"
HAIKU_MODEL = "claude-haiku-4-5-20251001"
RAW_TEXT_MAX = 80_000  # chars stored in raw_text field

EXTRACTION_PROMPT = """\
Extract structured job information from the following job posting text.
Return ONLY a valid JSON object with exactly these fields (use null for missing values):
{
  "company": "company name",
  "org_team": "team or department within company, or null",
  "job_title": "exact job title",
  "job_type": "Data Scientist or Data Science Engineer or ML Engineer or AI Engineer or Data Engineer or Analytics Engineer or GenAI/LLM Engineer or Other",
  "locations": [{"city": "city name or null", "state": "2-letter US state abbreviation or null"}],
  "work_arrangement": "remote or hybrid or onsite or null",
  "salary_min": integer in USD or null,
  "salary_max": integer in USD or null,
  "salary_currency": "USD",
  "job_source": "name of job board or company site",
  "date_posted": "YYYY-MM-DD or null",
  "days_ago": integer number of days ago the job was posted or null,
  "summary": "2-4 sentence summary covering the role, team context, and top requirements, max 400 chars or null"
}

For locations: include all advertised locations as separate objects in the array; use an empty array [] if none.
For work_arrangement: use "remote" for fully remote, "hybrid" for hybrid/flexible, "onsite" for in-office only, null if not specified.
For days_ago: if the posting says something like "Posted 3 days ago" or "3d ago", extract that integer (e.g. 3). If an exact date_posted is available, leave days_ago as null. Do not calculate the date yourself — just extract the number.

Job posting text:
"""


def _extract_json(raw: str) -> dict:
    """Parse JSON from model output with multiple fallback strategies."""
    # 1. Try fence blocks (```json ... ``` or ``` ... ```)
    if "```" in raw:
        for block in raw.split("```")[1::2]:
            candidate = block.lstrip("json").strip()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue

    # 2. Try direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 3. Regex: extract outermost { ... }
    match = re.search(r'\{[\s\S]*\}', raw)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"No valid JSON found in model response: {raw[:300]!r}")


def _coerce_extracted(data: dict) -> dict:
    """Type coercion shared by strict and lenient parsing. Never raises."""
    if not isinstance(data, dict):
        return {}

    str_fields = {"company", "org_team", "job_title", "job_type", "work_arrangement",
                  "job_source", "date_posted", "summary", "salary_currency"}
    for f in str_fields:
        if f in data and data[f] is not None and not isinstance(data[f], str):
            data[f] = str(data[f])

    for f in ("salary_min", "salary_max"):
        if f in data and data[f] is not None:
            try:
                data[f] = int(data[f])
            except (TypeError, ValueError):
                data[f] = None

    days_ago = data.pop("days_ago", None)
    if days_ago is not None:
        try:
            data["date_posted"] = (date.today() - timedelta(days=int(days_ago))).isoformat()
        except (TypeError, ValueError):
            pass

    if not isinstance(data.get("locations"), list):
        data["locations"] = []

    return data


def _validate_extracted(data: dict) -> dict:
    """Coerce types and assert required fields exist."""
    if not isinstance(data, dict):
        raise ValueError(f"Expected dict, got {type(data).__name__}")

    for field in ("company", "job_title"):
        if not data.get(field):
            raise ValueError(f"Extracted JSON missing required field: {field!r}")

    return _coerce_extracted(data)


def _parse_with_haiku(text: str) -> dict:
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set")
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": EXTRACTION_PROMPT + text[:16000]}],
    )
    raw = msg.content[0].text.strip()
    result = _extract_json(raw)
    return _validate_extracted(result)


def _parse_with_haiku_lenient(text: str) -> dict:
    """Like _parse_with_haiku, but never raises when company/job_title are
    missing — used by rescrape_preserving_date_posted, where a partial
    result (everything but, say, company) is still worth merging in rather
    than discarding outright."""
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set")
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": EXTRACTION_PROMPT + text[:16000]}],
    )
    raw = msg.content[0].text.strip()
    result = _extract_json(raw)
    return _coerce_extracted(result)


def classify_analyst_job(job: dict, prompt_template: str) -> tuple[bool, float]:
    """
    Single Haiku call classifying one job against the caller-supplied prompt
    template (db.get_analyst_config()["prompt_template"], editable in the
    Discovery Settings GUI — see discovery.run_analyst_discovery). Must contain
    {job_title} and {text} placeholders (enforced at save time in db.py).
    Returns (is_match, latency_seconds).
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

    text = (job.get("raw_text") or job.get("summary") or "").strip()[:1200]
    prompt = prompt_template.format(
        job_title=job.get("job_title") or "Unknown",
        text=text or "(no description available)",
    )

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    start = time.time()
    msg = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=8,
        messages=[{"role": "user", "content": prompt}],
    )
    latency = time.time() - start
    answer = msg.content[0].text.strip().lower()
    return answer.startswith("y"), latency


def _log(url: str, method: str, success: bool, latency_ms: int, error: str = None):
    try:
        import sys
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from db import insert_scraper_log
        insert_scraper_log(url, method, success, latency_ms, error)
    except Exception:
        pass


def extract_job_from_text(text: str) -> tuple[dict, str | None]:
    """Parse structured job data from raw text — no URL fetching."""
    start = time.time()
    try:
        data = _parse_with_haiku(text)
        latency = int((time.time() - start) * 1000)
        _log("manual_text", "manual_text", True, latency)
        data["raw_text"] = text[:RAW_TEXT_MAX]
        return data, None
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        _log("manual_text", "manual_text", False, latency, str(e))
        return {}, f"AI parsing failed: {e}"


def _fetch_page_text(url: str) -> tuple[str | None, str | None]:
    """Fetch the raw page text for url via Jina Reader, falling back to
    Playwright. Returns (text, None) on success or (None, error_message) if
    both methods fail. Every attempt is logged to scraper_log."""
    # ── Jina Reader ───────────────────────────────────────────────────────────
    start = time.time()
    try:
        resp = httpx.get(
            f"{JINA_BASE}{url}",
            timeout=20,
            headers={"Accept": "text/plain", "X-Return-Format": "text"},
            follow_redirects=True,
        )
        latency = int((time.time() - start) * 1000)
        if resp.status_code == 200 and len(resp.text.strip()) > 100:
            _log(url, "jina", True, latency)
            return resp.text, None
        else:
            _log(url, "jina", False, latency, f"HTTP {resp.status_code} or empty body")
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        _log(url, "jina", False, latency, str(e))

    # ── Playwright fallback ───────────────────────────────────────────────────
    start = time.time()
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, timeout=25000)
            page.wait_for_load_state("networkidle", timeout=15000)
            text = page.inner_text("body")
            browser.close()
        latency = int((time.time() - start) * 1000)
        if text.strip():
            _log(url, "playwright", True, latency)
            return text, None
        else:
            _log(url, "playwright", False, latency, "Empty page body")
            return None, "Both Jina and Playwright returned no usable content"
    except ImportError:
        latency = int((time.time() - start) * 1000)
        _log(url, "playwright", False, latency, "playwright not installed")
        return None, (
            "Jina failed and Playwright is not installed.\n"
            "Install with: pip install playwright && playwright install chromium"
        )
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        _log(url, "playwright", False, latency, str(e))
        return None, f"Both fetch methods failed. Last error: {e}"


def rescrape_preserving_date_posted(data: dict) -> dict:
    """Re-fetch the full posting at data['job_link'] and merge in whatever
    Haiku can parse from it, but never touch date_posted — hiring.cafe's
    estimated_publish_date is a more reliable signal than whatever Haiku
    infers from page text, so the value already present in data is always
    kept as-is.

    The freshly-scraped full job description (raw_text) is always merged in
    as long as the page fetch itself succeeds, even when Haiku can only
    partially parse it (or fails to parse it at all) — a struggling AI
    extraction shouldn't cost the user the underlying posting text. Only
    the individual structured fields Haiku actually found are merged in;
    fields it couldn't find are left as whatever data already had. Callers
    that need company/job_title to be present (e.g. saving into
    job_applications, which requires both) must check the merged result
    themselves — this function does not raise when they're still missing.
    """
    job_link = data.get("job_link")
    if not job_link:
        return data
    text, fetch_error = _fetch_page_text(job_link)
    if fetch_error or not text:
        return data

    merged = dict(data)
    merged["raw_text"] = text[:RAW_TEXT_MAX]
    merged["job_link"] = job_link

    try:
        extracted = _parse_with_haiku_lenient(text)
    except Exception:
        extracted = {}

    date_posted = data.get("date_posted")
    for key, value in extracted.items():
        if key in ("date_posted", "raw_text", "job_link") or value in (None, [], ""):
            continue
        merged[key] = value
    merged["date_posted"] = date_posted
    return merged


def extract_job_from_url(url: str) -> tuple[dict, str | None]:
    """
    Returns (data_dict, error_message_or_None).
    Tries Jina Reader first, then Playwright as fallback.
    data_dict includes 'raw_text' with the full scraped page content.
    """
    text, error = _fetch_page_text(url)
    if error or not text:
        return {}, error or "No usable content returned"
    try:
        data = _parse_with_haiku(text)
        data["job_link"] = url
        data["raw_text"] = text[:RAW_TEXT_MAX]
        return data, None
    except Exception as e:
        return {}, f"Fetched content but AI parsing failed: {e}"
