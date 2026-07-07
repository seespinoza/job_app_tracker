import os
import re
import time
import json
import httpx
import urllib.parse
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
  "job_type": "Data Scientist or ML Engineer or AI Engineer or Data Engineer or Other",
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


# ── Hiring Cafe Inbox ─────────────────────────────────────────────────────────

_LOC_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".hiring_cafe_locations.json")

INBOX_QUERIES = ["data scientist", "ml engineer", "ai engineer"]

INBOX_LOCATIONS = [
    ("Remote",              None),
    ("Nashville, TN",       "Nashville, TN"),
    ("Atlanta, GA",         "Atlanta, GA"),
    ("Charleston, SC",      "Charleston, SC"),
    ("Charlotte, NC",       "Charlotte, NC"),
    ("Richmond, VA",        "Richmond, VA"),
    ("Raleigh/Durham, NC",  "Raleigh, NC"),
    ("Winston-Salem, NC",   "Winston-Salem, NC"),
    ("Charlottesville, VA", "Charlottesville, VA"),
]

INBOX_PERIODS = [
    {"label": "24h", "days": 2},
    {"label": "3d",  "days": 3},
]

_RICHMOND_LOC = {
    "id": "Hhk1yZQBoEtHp_8UuMkY",
    "types": ["locality"],
    "address_components": [
        {"long_name": "Richmond",       "short_name": "Richmond", "types": ["locality"]},
        {"long_name": "Virginia",       "short_name": "VA",       "types": ["administrative_area_level_1"]},
        {"long_name": "United States",  "short_name": "US",       "types": ["country"]},
    ],
    "geometry": {"location": {"lat": 37.55376, "lon": -77.46026}},
    "formatted_address": "Richmond, VA, US",
    "population": 226610,
    "workplace_types": [],
    "options": {"radius": 50, "radius_unit": "miles", "ignore_radius": False},
}


def _load_loc_cache() -> dict:
    try:
        if os.path.exists(_LOC_CACHE_PATH):
            with open(_LOC_CACHE_PATH) as f:
                return json.load(f)
    except Exception:
        pass
    return {"Richmond, VA": _RICHMOND_LOC}


def _save_loc_cache(cache: dict):
    try:
        with open(_LOC_CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception:
        pass


def _resolve_location_playwright(search_term: str) -> dict | None:
    """Navigate hiring.cafe UI to get the proper location object (with ID) for a city."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto("https://hiring.cafe/", timeout=30000)
            page.wait_for_load_state("networkidle", timeout=20000)

            loc_input = None
            for sel in [
                'input[placeholder*="ocation" i]',
                'input[placeholder*="city" i]',
                'input[aria-label*="ocation" i]',
                '[class*="location" i] input',
            ]:
                try:
                    el = page.wait_for_selector(sel, timeout=2000)
                    if el and el.is_visible():
                        loc_input = el
                        break
                except Exception:
                    pass

            if not loc_input:
                return None

            loc_input.click()
            page.wait_for_timeout(300)
            loc_input.fill(search_term)
            page.wait_for_timeout(2000)

            suggestion = None
            for sel in ['[role="option"]', '[class*="suggestion" i]', '[class*="autocomplete" i] li']:
                try:
                    el = page.wait_for_selector(sel, timeout=2000)
                    if el:
                        suggestion = el
                        break
                except Exception:
                    pass

            if not suggestion:
                return None

            suggestion.click()
            page.wait_for_timeout(1500)

            current_url = page.url
            if "searchState=" not in current_url:
                return None

            qs = urllib.parse.parse_qs(urllib.parse.urlparse(current_url).query)
            state_str = qs.get("searchState", [None])[0]
            if not state_str:
                return None

            state = json.loads(state_str)
            locs = state.get("locations", [])
            return locs[0] if locs else None
        except Exception:
            return None
        finally:
            browser.close()


def resolve_all_inbox_locations() -> dict:
    """
    Ensure all non-Remote locations have a cached location object.
    Resolves missing ones via Playwright and returns the full cache.
    Yields (display_name, status) tuples as it works.
    """
    cache = _load_loc_cache()
    for (display, search_term) in INBOX_LOCATIONS:
        if display == "Remote" or display in cache:
            yield (display, "cached")
            continue
        loc = _resolve_location_playwright(search_term)
        if loc:
            cache[display] = loc
            _save_loc_cache(cache)
            yield (display, "resolved")
        else:
            yield (display, "failed")
    return cache


def get_inbox_combinations() -> list[dict]:
    """All 54 search combos (9 locations × 3 queries × 2 time periods)."""
    cache = _load_loc_cache()
    combos = []
    for query in INBOX_QUERIES:
        for (loc_name, search_term) in INBOX_LOCATIONS:
            loc_obj = cache.get(loc_name) if loc_name != "Remote" else None
            for period in INBOX_PERIODS:
                state: dict = {"searchQuery": query, "dateFetchedPastNDays": period["days"]}
                if loc_name == "Remote":
                    state["workplaceTypes"] = ["Remote"]
                elif loc_obj:
                    state["locations"] = [loc_obj]
                combos.append({
                    "label":       f"{query} | {loc_name} | {period['label']}",
                    "query":       query,
                    "loc_name":    loc_name,
                    "search_term": search_term,
                    "days":        period["days"],
                    "search_state": state,
                    "has_loc":     loc_name == "Remote" or loc_obj is not None,
                })
    return combos


def _extract_native_url(page) -> str | None:
    """Extract the native company job URL from a hiring.cafe job detail page."""

    # 1. __NEXT_DATA__ deep search
    try:
        nd_text = page.evaluate(
            "() => { const el = document.getElementById('__NEXT_DATA__'); return el ? el.textContent : null; }"
        )
        if nd_text:
            nd = json.loads(nd_text)
            found = _deep_find_apply_url(nd, 0)
            if found:
                return found
    except Exception:
        pass

    # 2. Anchor tags with external hrefs
    try:
        urls = page.evaluate("""() => {
            const SKIP = ['hiring.cafe','reddit.com','google.com','twitter.com','mailto:','linkedin.com/company'];
            return [...document.querySelectorAll('a[href^="http"]')]
                .map(a => a.href)
                .filter(h => SKIP.every(s => !h.includes(s)));
        }""")
        if urls:
            # Prefer URLs that look like job application links
            for u in urls:
                lc = u.lower()
                if any(kw in lc for kw in ("apply", "job", "career", "greenhouse.io", "lever.co",
                                            "workday", "taleo", "icims", "myworkday")):
                    return u
            return urls[0]
    except Exception:
        pass

    # 3. Click apply button and catch popup/navigation
    for sel in [
        'a:has-text("Apply Directly")',
        'button:has-text("Apply Directly")',
        'a:has-text("Apply now")',
        'a:has-text("Apply Now")',
        '[class*="apply" i] a[href^="http"]',
    ]:
        try:
            el = page.query_selector(sel)
            if not el:
                continue
            href = el.get_attribute("href") or ""
            if href.startswith("http") and "hiring.cafe" not in href:
                return href
            with page.expect_popup(timeout=4000) as popup_info:
                el.click()
            popup = popup_info.value
            pu = popup.url
            popup.close()
            if pu and "hiring.cafe" not in pu and pu.startswith("http"):
                return pu
        except Exception:
            pass

    return None


def _deep_find_apply_url(data, depth: int) -> str | None:
    """Recursively look for a native apply URL in a JSON blob."""
    if depth > 7:
        return None
    if isinstance(data, str):
        return None
    if isinstance(data, dict):
        for key in ("applyUrl", "applicationUrl", "externalUrl", "sourceUrl",
                    "apply_url", "external_url", "originalUrl", "jobUrl",
                    "applicationLink", "applyLink", "directUrl", "link"):
            val = data.get(key)
            if isinstance(val, str) and val.startswith("http") and "hiring.cafe" not in val:
                return val
        for v in data.values():
            found = _deep_find_apply_url(v, depth + 1)
            if found:
                return found
    elif isinstance(data, list):
        for item in data:
            found = _deep_find_apply_url(item, depth + 1)
            if found:
                return found
    return None


def scrape_hiring_cafe_combo(combo: dict) -> list[dict]:
    """
    Load one hiring.cafe search page, then load each job detail page to get
    the native company URL. Returns list of {'native_url', 'hiring_cafe_path'}.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return []

    # If location wasn't resolved at combo-build time, try now
    search_state = combo["search_state"]
    if not combo["has_loc"] and combo["loc_name"] != "Remote" and combo.get("search_term"):
        cache = _load_loc_cache()
        if combo["loc_name"] not in cache:
            loc = _resolve_location_playwright(combo["search_term"])
            if loc:
                cache[combo["loc_name"]] = loc
                _save_loc_cache(cache)
        loc_obj = cache.get(combo["loc_name"])
        if loc_obj:
            search_state = dict(search_state)
            search_state["locations"] = [loc_obj]

    url = (
        "https://hiring.cafe/?searchState="
        + urllib.parse.quote(json.dumps(search_state, ensure_ascii=False))
    )

    jobs = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            # --- Get job paths from search page ---
            search_page = browser.new_page()
            try:
                search_page.goto(url, timeout=30000)
                search_page.wait_for_load_state("networkidle", timeout=20000)
            except Exception:
                pass

            job_paths: list[str] = []
            try:
                job_paths = search_page.evaluate("""() => {
                    const seen = new Set();
                    const out = [];
                    for (const a of document.querySelectorAll('a[href^="/job/"]')) {
                        const h = a.getAttribute('href');
                        if (h && !seen.has(h)) { seen.add(h); out.push(h); }
                    }
                    return out.slice(0, 20);
                }""")
            except Exception:
                pass
            finally:
                search_page.close()

            # --- For each job path, get native URL from detail page ---
            for job_path in (job_paths or []):
                detail_page = browser.new_page()
                try:
                    detail_page.goto(f"https://hiring.cafe{job_path}", timeout=25000)
                    detail_page.wait_for_load_state("networkidle", timeout=15000)
                    native_url = _extract_native_url(detail_page)
                    if native_url:
                        jobs.append({"native_url": native_url, "hiring_cafe_path": job_path})
                except Exception:
                    pass
                finally:
                    detail_page.close()
        finally:
            browser.close()

    return jobs


# ── End Hiring Cafe ────────────────────────────────────────────────────────────


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
