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


def _validate_extracted(data: dict) -> dict:
    """Coerce types and assert required fields exist."""
    if not isinstance(data, dict):
        raise ValueError(f"Expected dict, got {type(data).__name__}")

    for field in ("company", "job_title"):
        if not data.get(field):
            raise ValueError(f"Extracted JSON missing required field: {field!r}")

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


ANALYST_FILTER_PROMPT = """\
You are screening a single "Analyst" job posting. Decide whether its description \
explicitly mentions BOTH:
1. Python (as a programming language/skill), AND
2. machine learning (or ML) as a skill, responsibility, or requirement.

Only answer yes if both are clearly present in the text — do not infer or guess \
from the job title alone.

Respond with ONLY one word: "yes" or "no".

Job title: {job_title}
Description:
{text}
"""


def classify_analyst_job(job: dict) -> tuple[bool, float]:
    """
    Single Haiku call classifying one job: does its description mention both
    Python and machine learning? Returns (is_match, latency_seconds).
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

    text = (job.get("raw_text") or job.get("summary") or "").strip()[:1200]
    prompt = ANALYST_FILTER_PROMPT.format(
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


def rescrape_preserving_date_posted(data: dict) -> dict:
    """Re-run the full extraction pipeline against data['job_link'] and merge the
    results in, but never touch date_posted — hiring.cafe's estimated_publish_date
    is a more reliable signal than whatever Haiku infers from page text, so the
    value already present in data is always kept as-is.
    """
    job_link = data.get("job_link")
    if not job_link:
        return data
    extracted, error = extract_job_from_url(job_link)
    if error or not extracted:
        return data
    date_posted = data.get("date_posted")
    merged = dict(data)
    for key, value in extracted.items():
        if key == "date_posted" or value in (None, [], ""):
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
            try:
                data = _parse_with_haiku(resp.text)
                data["job_link"] = url
                data["raw_text"] = resp.text[:RAW_TEXT_MAX]
                return data, None
            except Exception as e:
                return {}, f"Jina fetched content but AI parsing failed: {e}"
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
            try:
                data = _parse_with_haiku(text)
                data["job_link"] = url
                data["raw_text"] = text[:RAW_TEXT_MAX]
                return data, None
            except Exception as e:
                return {}, f"Playwright fetched content but AI parsing failed: {e}"
        else:
            _log(url, "playwright", False, latency, "Empty page body")
            return {}, "Both Jina and Playwright returned no usable content"
    except ImportError:
        latency = int((time.time() - start) * 1000)
        _log(url, "playwright", False, latency, "playwright not installed")
        return {}, (
            "Jina failed and Playwright is not installed.\n"
            "Install with: pip install playwright && playwright install chromium"
        )
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        _log(url, "playwright", False, latency, str(e))
        return {}, f"Both fetch methods failed. Last error: {e}"
