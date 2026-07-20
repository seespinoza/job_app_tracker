import os
import re
import json
import time
import httpx
from datetime import date, timedelta

import db

HC_BASE = "https://hiringcafe.com"
_LOC_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".hiring_cafe_locations.json")
_MAX_PAGES = 5  # safety cap on pagination per combo (200 hits max)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
}

# (display label, search term for resolve_location; "Remote" has no search term)
CITIES = [
    ("Charlotte, NC",       "Charlotte, NC"),
    ("Raleigh/Durham, NC",  "Raleigh, NC"),
    ("Winston-Salem, NC",   "Winston-Salem, NC"),
    ("Chapel Hill, NC",     "Chapel Hill, NC"),
    ("Charleston, SC",      "Charleston, SC"),
    ("Charlottesville, VA", "Charlottesville, VA"),
    ("Richmond, VA",        "Richmond, VA"),
    ("Nashville, TN",       "Nashville, TN"),
    ("Atlanta, GA",         "Atlanta, GA"),
]

LOCATIONS = [("Remote", None)] + CITIES

# Title substrings (lowercase) to drop — loose hiring.cafe free-text matching
# pulls these in alongside real IC DS/ML/AI roles.
_EXCLUDED_TITLE_KEYWORDS = ["software", "manager", "director"]

_build_id_cache: str | None = None


def _load_loc_cache() -> dict:
    try:
        if os.path.exists(_LOC_CACHE_PATH):
            with open(_LOC_CACHE_PATH) as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_loc_cache(cache: dict):
    try:
        with open(_LOC_CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception:
        pass


def resolve_location(city_state: str) -> dict | None:
    """Resolve a 'City, ST' string to hiring.cafe's location placeDetail object via /api/searchLocation."""
    try:
        resp = httpx.get(
            f"{HC_BASE}/api/searchLocation",
            params={"query": city_state},
            headers=_HEADERS,
            timeout=15,
            follow_redirects=True,
        )
        if resp.status_code != 200:
            return None
        results = resp.json()
        if not results:
            return None
        place = results[0].get("placeDetail")
        if place:
            # Without an explicit radius, hiring.cafe's location filter matches nothing.
            place["options"] = {"radius": 50, "radius_unit": "miles", "ignore_radius": False}
        return place
    except Exception:
        return None


def resolve_all_locations() -> dict:
    """Ensure every named city has a cached location object. Yields (label, status)."""
    cache = _load_loc_cache()
    for (label, search_term) in LOCATIONS:
        if label == "Remote":
            continue
        if label in cache:
            yield (label, "cached")
            continue
        loc = resolve_location(search_term)
        if loc:
            cache[label] = loc
            _save_loc_cache(cache)
            yield (label, "resolved")
        else:
            yield (label, "failed")


def get_location(label: str) -> dict | None:
    if label == "Remote":
        return None
    cache = _load_loc_cache()
    return cache.get(label)


def get_build_id(force_refresh: bool = False) -> str | None:
    global _build_id_cache
    if _build_id_cache and not force_refresh:
        return _build_id_cache
    try:
        resp = httpx.get(f"{HC_BASE}/", headers=_HEADERS, timeout=20, follow_redirects=True)
        if resp.status_code != 200:
            return None
        match = re.search(
            r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.S
        )
        if not match:
            return None
        data = json.loads(match.group(1))
        build_id = data.get("buildId")
        if build_id:
            _build_id_cache = build_id
        return build_id
    except Exception:
        return None


def _fetch_page(build_id: str, search_state: dict, page: int) -> httpx.Response:
    encoded_state = json.dumps(search_state, ensure_ascii=False)
    return httpx.get(
        f"{HC_BASE}/_next/data/{build_id}/index.json",
        params={"searchState": encoded_state, "page": page},
        headers=_HEADERS,
        timeout=20,
        follow_redirects=True,
    )


def search_jobs(query: str, location: dict | None, is_remote: bool, days: int = 3) -> list[dict]:
    """Search hiring.cafe and return raw ssrHits, paginated up to _MAX_PAGES. No browser needed."""
    search_state: dict = {"searchQuery": query, "dateFetchedPastNDays": days}
    if is_remote:
        search_state["workplaceTypes"] = ["Remote"]
    elif location:
        search_state["locations"] = [location]

    build_id = get_build_id()
    if not build_id:
        raise RuntimeError("Could not resolve hiring.cafe build id")

    hits: list[dict] = []
    for page in range(_MAX_PAGES):
        resp = _fetch_page(build_id, search_state, page)
        if resp.status_code == 404:
            # Stale build id (hiring.cafe redeployed) — refresh once and retry this page
            build_id = get_build_id(force_refresh=True)
            if not build_id:
                raise RuntimeError("Could not refresh hiring.cafe build id after 404")
            resp = _fetch_page(build_id, search_state, page)
        resp.raise_for_status()
        payload = resp.json()
        page_props = payload.get("pageProps", {})
        page_hits = page_props.get("ssrHits") or []
        hits.extend(page_hits)
        if page_props.get("ssrIsLastPage", True) or not page_hits:
            break
    return hits


_STATE_NAME_TO_ABBR = {v.lower(): k for k, v in db.US_STATES.items()}


def _to_state_abbrev(name: str | None) -> str | None:
    if not name:
        return None
    name = name.strip()
    if len(name) == 2:
        return name.upper()
    return _STATE_NAME_TO_ABBR.get(name.lower())


def _parse_workplace_locations(v5: dict) -> list[dict]:
    cities = v5.get("workplace_cities") or []
    locs = []
    for entry in cities:
        parts = [p.strip() for p in str(entry).split(",")]
        city = parts[0] if parts and parts[0] else None
        state = _to_state_abbrev(parts[1]) if len(parts) >= 2 else None
        if city:
            locs.append({"city": city, "state": state})
    return locs


def _normalize_work_arrangement(workplace_type: str | None) -> str | None:
    if not workplace_type:
        return None
    wt = workplace_type.lower()
    if "remote" in wt:
        return "remote"
    if "hybrid" in wt:
        return "hybrid"
    if "on-site" in wt or "onsite" in wt or "on site" in wt:
        return "onsite"
    return None


def _clean_date(raw) -> str | None:
    if not raw:
        return None
    s = str(raw)
    match = re.match(r"^\d{4}-\d{2}-\d{2}", s)
    return match.group(0) if match else s[:10]


def normalize_hit(hit: dict, job_type: str, search_location_label: str, max_age_days: int = 3) -> dict | None:
    """Map one raw ssrHits entry into the app's job-row shape, or None to skip it.

    hiring.cafe's own `dateFetchedPastNDays` search param filters by when *they*
    last re-crawled a listing as still active, not by when it was originally
    posted — long-dead-but-still-live postings pass it easily. `estimated_publish_date`
    is the only real proxy for actual posting recency, so it's enforced here as a
    strict client-side filter; hits with no extractable date are dropped rather
    than trusted by default.
    """
    if hit.get("is_expired"):
        return None
    if hit.get("is_hc_pinned") or hit.get("source") == "hiring_cafe_pin":
        return None

    v5 = hit.get("v5_processed_job_data", {}) or {}

    posted_date_str = _clean_date(v5.get("estimated_publish_date"))
    if not posted_date_str:
        return None
    try:
        posted_date = date.fromisoformat(posted_date_str)
    except ValueError:
        return None
    if posted_date < date.today() - timedelta(days=max_age_days):
        return None

    job_info = hit.get("job_information", {}) or {}
    company_data = hit.get("enriched_company_data", {}) or {}

    hc_id = hit.get("objectID") or hit.get("id")
    job_link = hit.get("apply_url") or hit.get("hc_apply_url")
    if not hc_id or not job_link:
        return None

    company = company_data.get("name") or hit.get("board_token")
    job_title = job_info.get("title") or hit.get("job_title") or v5.get("core_job_title")
    if not company or not job_title:
        return None
    if any(kw in job_title.lower() for kw in _EXCLUDED_TITLE_KEYWORDS):
        # Loose free-text matching on hiring.cafe pulls in generic Software Engineer
        # and management postings alongside real IC DS/ML/AI roles — excluded for now.
        return None

    locations = _parse_workplace_locations(v5)
    salary_min = v5.get("yearly_min_compensation")
    salary_max = v5.get("yearly_max_compensation")

    summary = (v5.get("requirements_summary") or "").strip()
    if len(summary) > 400:
        summary = summary[:397] + "..."

    return {
        "hc_id": hc_id,
        "company": company,
        "job_title": job_title,
        "job_type": job_type,
        "locations": locations,
        "work_arrangement": _normalize_work_arrangement(v5.get("workplace_type")),
        "salary_min": int(salary_min) if salary_min else None,
        "salary_max": int(salary_max) if salary_max else None,
        "salary_currency": v5.get("listed_compensation_currency") or "USD",
        "job_link": job_link,
        "job_source": "hiring.cafe",
        "summary": summary or None,
        "raw_text": None,
        "date_posted": _clean_date(v5.get("estimated_publish_date")),
        "seniority_level": v5.get("seniority_level"),
        "min_yoe": v5.get("min_industry_and_role_yoe"),
        "job_category": v5.get("job_category"),
        "search_location": search_location_label,
    }
