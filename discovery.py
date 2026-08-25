import os

import db
import scraper
import hiring_cafe_client

DATE_WINDOW_DAYS = 3


def run_analyst_discovery(days: int = DATE_WINDOW_DAYS):
    """
    Synchronous generator, mirroring run_discovery()'s event pattern: live-
    searches hiring.cafe for the analyst rule's search query (DB-configured,
    editable in Discovery Settings) across every enabled location, independent
    of whatever the last Run Discovery pass happened to surface under the
    configured job tracks.

    Deliberately does not filter on job_title — relevance is judged purely
    by the Haiku classification pass that follows (per the DB-configured
    prompt template), not by whether the search term literally appears in
    the title. Every normalized, deduped hit is upserted into discovered_jobs
    so it behaves like any other discovered job (taggable, saveable) before
    classification even runs; matches get tagged with the configured tag
    directly on the DB row.
    """
    analyst_cfg = db.get_analyst_config()
    locations = hiring_cafe_client.get_all_locations()
    total_locations = len(locations)
    run_id = db.create_scrape_run(total_locations, run_type="analyst_ml")

    build_id = hiring_cafe_client.get_build_id()
    if not build_id:
        db.finish_scrape_run(run_id, status="error")
        yield {"type": "fatal_error", "message": "Could not reach hiring.cafe"}
        return

    if not os.environ.get("ANTHROPIC_API_KEY"):
        db.finish_scrape_run(run_id, status="error")
        yield {"type": "fatal_error", "message": "ANTHROPIC_API_KEY is not set — cannot classify with Haiku"}
        return

    for (_label, _status) in hiring_cafe_client.resolve_all_locations():
        pass

    tracked_urls = db.get_all_tracked_urls()
    seen_hc_ids = set()
    candidates = []

    yield {"type": "start", "total": total_locations, "run_id": run_id}

    for i, (loc_label, _search_term) in enumerate(locations):
        yield {"type": "searching", "label": loc_label, "n": i + 1, "total": total_locations}
        is_remote = loc_label == "Remote"
        location = None if is_remote else hiring_cafe_client.get_location(loc_label)
        try:
            raw_hits = hiring_cafe_client.search_jobs(
                analyst_cfg["search_query"], location, is_remote, days=days
            )
        except Exception as e:
            yield {"type": "combo_error", "label": loc_label, "error": str(e)}
            raw_hits = []

        for hit in raw_hits:
            normalized = hiring_cafe_client.normalize_hit(
                hit, "Analyst", loc_label, max_age_days=days
            )
            if not normalized:
                continue
            if normalized["job_link"] in tracked_urls:
                continue
            if normalized["hc_id"] in seen_hc_ids:
                continue
            seen_hc_ids.add(normalized["hc_id"])
            normalized["search_query"] = analyst_cfg["search_query"]
            job_id, is_new = db.upsert_discovered_job(normalized, run_id=run_id)
            candidates.append({**normalized, "id": job_id, "is_new": is_new})

        db.update_scrape_run(run_id, combos_done=i + 1, jobs_found=len(candidates))
        yield {"type": "combo_done", "label": loc_label, "n": i + 1, "total": total_locations}

    total_candidates = len(candidates)
    yield {"type": "classify_start", "total": total_candidates}

    matched = 0
    for idx, job in enumerate(candidates):
        yield {
            "type": "classifying", "n": idx + 1, "total": total_candidates,
            "job_title": job.get("job_title"),
        }
        try:
            is_match, _latency = scraper.classify_analyst_job(job, analyst_cfg["prompt_template"])
        except Exception as e:
            yield {"type": "classify_error", "job_id": job["id"], "job_title": job.get("job_title"), "error": str(e)}
            continue
        if is_match:
            tags = sorted({*(job.get("tags") or []), analyst_cfg["tag"]})
            if job.get("is_new"):
                # This row was inserted fresh for this run — safe to tag in place.
                db.update_discovered_job_tags(job["id"], tags)
                final_id = job["id"]
            else:
                # An earlier batch already discovered this posting; tagging that
                # row in place would leave the match hidden under the wrong
                # (stale) batch, since run_id is never reassigned. Insert this
                # run's own tagged copy instead of touching the original.
                final_id, _ = db.upsert_discovered_job(job, run_id=run_id, force_insert=True, tags=tags)
            matched += 1
            db.update_scrape_run(run_id, jobs_new=matched)
            yield {"type": "matched", "data": {**job, "id": final_id, "tags": tags}}

    db.finish_scrape_run(run_id, status="done")
    yield {"type": "done", "run_id": run_id, "candidates_found": total_candidates, "jobs_matched": matched}


def get_discovery_combinations() -> list[dict]:
    """All combos of enabled job tracks × locations, sourced from the DB-backed
    Discovery Settings config (editable in the GUI) rather than hardcoded lists."""
    combos = []
    tracks = [(row["label"], row["query"]) for row in db.get_job_tracks(enabled_only=True)]
    for job_type, query in tracks:
        for loc_label, _search_term in hiring_cafe_client.get_all_locations():
            is_remote = loc_label == "Remote"
            combos.append({
                "label":    f"{job_type} | {loc_label}",
                "job_type": job_type,
                "query":    query,
                "loc_label": loc_label,
                "is_remote": is_remote,
            })
    return combos


def _needs_enrichment(normalized: dict) -> bool:
    has_salary = bool(normalized.get("salary_min") or normalized.get("salary_max"))
    has_summary = bool(normalized.get("summary"))
    return not has_salary and not has_summary


def run_discovery():
    """
    Synchronous generator that runs the full two-phase discovery pipeline,
    yielding plain event dicts. Starlette's StreamingResponse runs sync
    generators in a threadpool automatically, so this doesn't need asyncio.
    """
    combos = get_discovery_combinations()
    total = len(combos)
    run_id = db.create_scrape_run(total)

    build_id = hiring_cafe_client.get_build_id()
    if not build_id:
        db.finish_scrape_run(run_id, status="error")
        yield {"type": "fatal_error", "message": "Could not reach hiring.cafe"}
        return

    for (label, status) in hiring_cafe_client.resolve_all_locations():
        if status == "failed":
            yield {
                "type": "location_warn", "location": label,
                "message": "Could not resolve location — results may be incomplete",
            }

    tracked_urls = db.get_all_tracked_urls()
    known_df = db.get_discovered_jobs(include_dismissed=True)
    known_hc_ids = set(known_df["hc_id"]) if not known_df.empty else set()

    yield {"type": "start", "total": total, "run_id": run_id}

    combos_done = 0
    jobs_found_total = 0
    jobs_new_total = 0
    enrich_queue: list[tuple[int, str]] = []

    for i, combo in enumerate(combos):
        yield {"type": "searching", "label": combo["label"], "n": i + 1, "total": total}

        try:
            location = None if combo["is_remote"] else hiring_cafe_client.get_location(combo["loc_label"])
            raw_hits = hiring_cafe_client.search_jobs(
                combo["query"], location, combo["is_remote"], days=DATE_WINDOW_DAYS
            )
        except Exception as e:
            combos_done += 1
            db.update_scrape_run(run_id, combos_done=combos_done)
            yield {"type": "combo_error", "label": combo["label"], "error": str(e)}
            continue

        combo_new = 0
        for hit in raw_hits:
            normalized = hiring_cafe_client.normalize_hit(
                hit, combo["job_type"], combo["loc_label"], max_age_days=DATE_WINDOW_DAYS
            )
            if not normalized:
                continue
            if normalized["job_link"] in tracked_urls:
                continue
            normalized["search_query"] = combo["query"]

            jobs_found_total += 1
            is_new = normalized["hc_id"] not in known_hc_ids
            job_id, _ = db.upsert_discovered_job(normalized, run_id=run_id)

            if is_new:
                known_hc_ids.add(normalized["hc_id"])
                jobs_new_total += 1
                combo_new += 1
                if _needs_enrichment(normalized):
                    enrich_queue.append((job_id, normalized["job_link"]))
                yield {"type": "job", "data": {**normalized, "id": job_id, "run_id": run_id}}

        combos_done += 1
        db.update_scrape_run(
            run_id, combos_done=combos_done, jobs_found=jobs_found_total, jobs_new=jobs_new_total
        )
        yield {
            "type": "combo_done", "label": combo["label"], "n": combos_done,
            "total": total, "new_jobs": combo_new,
        }

    enrich_total = len(enrich_queue)
    yield {"type": "phase2_start", "total": enrich_total}

    enriched = 0
    failed = 0
    for idx, (job_id, job_link) in enumerate(enrich_queue):
        yield {"type": "enriching", "n": idx + 1, "total": enrich_total, "url": job_link}

        try:
            data, error = scraper.extract_job_from_url(job_link)
        except Exception as e:
            data, error = {}, str(e)

        if error or not data:
            db.update_discovered_job_enrichment(job_id, {}, "error", error or "No data returned")
            failed += 1
            yield {"type": "enrich_error", "job_id": job_id, "error": error}
        else:
            db.update_discovered_job_enrichment(job_id, data, "enriched")
            enriched += 1
            yield {"type": "enriched", "job_id": job_id}

        db.update_scrape_run(run_id, jobs_enriched=enriched, jobs_failed=failed)

    db.finish_scrape_run(run_id, status="done")
    yield {
        "type": "done", "run_id": run_id, "jobs_found": jobs_found_total,
        "jobs_new": jobs_new_total, "jobs_enriched": enriched, "jobs_failed": failed,
    }
