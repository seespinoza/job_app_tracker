from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional
import math
import os
import uuid
import json
import pandas as pd
import db
import scraper
import discovery

RESUME_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resumes")
os.makedirs(RESUME_DIR, exist_ok=True)

app = FastAPI(title="Job Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def df_to_records(df: pd.DataFrame) -> list:
    records = df.to_dict(orient="records")
    return [
        {k: None if isinstance(v, float) and math.isnan(v) else v for k, v in row.items()}
        for row in records
    ]


class ApplicationCreate(BaseModel):
    company: str
    org_team: Optional[str] = None
    job_title: str
    job_type: Optional[str] = None
    date_posted: Optional[str] = None
    date_applied: Optional[str] = None
    locations: list = []
    work_arrangement: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "USD"
    job_link: Optional[str] = None
    job_source: Optional[str] = None
    status: str = "applied"
    notes: Optional[str] = None
    summary: Optional[str] = None
    raw_text: Optional[str] = None
    is_headhunter_lead: bool = False
    recruiter_name: Optional[str] = None
    recruiter_contact: Optional[str] = None


class StatusUpdate(BaseModel):
    status: str


class TodoCreate(BaseModel):
    company: Optional[str] = None
    org_team: Optional[str] = None
    job_title: Optional[str] = None
    job_type: Optional[str] = None
    locations: list = []
    work_arrangement: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "USD"
    job_link: Optional[str] = None
    job_source: Optional[str] = None
    notes: Optional[str] = None
    summary: Optional[str] = None
    raw_text: Optional[str] = None
    extracted_by_ai: bool = False
    date_posted: Optional[str] = None


class TodoApply(BaseModel):
    date_applied: str


class ExtractRequest(BaseModel):
    url: str


class ExtractTextRequest(BaseModel):
    text: str


class NoteCreate(BaseModel):
    title: str = "Untitled"


class NoteUpdate(BaseModel):
    title: str
    content: str


class CommunicationCreate(BaseModel):
    application_id: Optional[int] = None
    contact_name: Optional[str] = None
    platform: Optional[str] = None
    direction: Optional[str] = None
    comm_date: Optional[str] = None
    note: Optional[str] = None
    follow_up_date: Optional[str] = None


class DiscoverySaveTodo(BaseModel):
    discovered_job_id: Optional[int] = None
    company: Optional[str] = None
    org_team: Optional[str] = None
    job_title: Optional[str] = None
    job_type: Optional[str] = None
    locations: list = []
    work_arrangement: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "USD"
    job_link: Optional[str] = None
    job_source: Optional[str] = None
    summary: Optional[str] = None
    raw_text: Optional[str] = None
    date_posted: Optional[str] = None
    extracted_by_ai: bool = True


class DiscoveredJobTags(BaseModel):
    tags: list[str] = []


class DiscoverySaveApplied(BaseModel):
    discovered_job_id: Optional[int] = None
    company: Optional[str] = None
    org_team: Optional[str] = None
    job_title: Optional[str] = None
    job_type: Optional[str] = None
    locations: list = []
    work_arrangement: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "USD"
    job_link: Optional[str] = None
    job_source: Optional[str] = None
    summary: Optional[str] = None
    raw_text: Optional[str] = None
    date_posted: Optional[str] = None
    date_applied: Optional[str] = None
    status: str = "applied"


@app.get("/api/config")
def get_config():
    return {
        "us_states": db.US_STATES,
        "job_types": db.JOB_TYPES,
        "job_sources": db.JOB_SOURCES,
        "job_statuses": db.JOB_STATUSES,
        "comm_platforms": db.COMM_PLATFORMS,
        "comm_directions": db.COMM_DIRECTIONS,
    }


@app.get("/api/applications")
def list_applications(status: Optional[str] = None):
    status_filter = status.split(",") if status else None
    df = db.get_job_applications(status_filter=status_filter)
    return df_to_records(df)


@app.post("/api/applications", status_code=201)
def create_application(body: ApplicationCreate):
    new_id = db.insert_job_application(body.dict())
    return {"id": new_id}


@app.put("/api/applications/{app_id}")
def update_application(app_id: int, body: ApplicationCreate):
    db.update_job_application(app_id, body.dict())
    return {"ok": True}


@app.delete("/api/applications/{app_id}")
def delete_application(app_id: int):
    db.delete_job_application(app_id)
    return {"ok": True}


@app.patch("/api/applications/{app_id}/status")
def update_status(app_id: int, body: StatusUpdate):
    db.update_application_status(app_id, body.status)
    return {"ok": True}


@app.get("/api/todos")
def list_todos():
    df = db.get_todo_applications()
    return df_to_records(df)


@app.post("/api/todos", status_code=201)
def create_todo(body: TodoCreate):
    new_id = db.insert_todo_application(body.dict())
    return {"id": new_id}


@app.delete("/api/todos/{todo_id}")
def remove_todo(todo_id: int):
    db.delete_todo_application(todo_id)
    return {"ok": True}


@app.post("/api/todos/{todo_id}/apply")
def apply_todo(todo_id: int, body: TodoApply):
    new_id = db.move_todo_to_applied(todo_id, body.date_applied)
    if new_id is None:
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"id": new_id}


@app.post("/api/extract")
def extract_url(body: ExtractRequest):
    data, error = scraper.extract_job_from_url(body.url)
    return {"error": error, "data": data}


@app.post("/api/extract-text")
def extract_text(body: ExtractTextRequest):
    data, error = scraper.extract_job_from_text(body.text)
    return {"error": error, "data": data}


@app.get("/api/notes")
def list_notes():
    return db.get_notes()


@app.get("/api/notes/{note_id}")
def get_note(note_id: int):
    note = db.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@app.post("/api/notes", status_code=201)
def create_note(body: NoteCreate):
    new_id = db.create_note(body.title)
    return {"id": new_id}


@app.put("/api/notes/{note_id}")
def update_note(note_id: int, body: NoteUpdate):
    db.update_note(note_id, body.title, body.content)
    return {"ok": True}


@app.delete("/api/notes/{note_id}")
def remove_note(note_id: int):
    db.delete_note(note_id)
    return {"ok": True}


@app.get("/api/applications/{app_id}/communications")
def list_communications(app_id: int):
    return db.get_communications(app_id)


@app.post("/api/applications/{app_id}/communications", status_code=201)
def create_communication(app_id: int, body: CommunicationCreate):
    data = body.dict()
    data["application_id"] = app_id
    new_id = db.add_communication(data)
    return {"id": new_id}


@app.delete("/api/communications/{comm_id}")
def remove_communication(comm_id: int):
    db.delete_communication(comm_id)
    return {"ok": True}


@app.get("/api/communications/upcoming-followups")
def upcoming_followups():
    return db.get_upcoming_followups()


@app.get("/api/resumes")
def list_resumes():
    return db.list_resumes()


@app.post("/api/resumes", status_code=201)
async def upload_resume(
    file: UploadFile = File(...),
    name: str = Form(...),
    date: str = Form(""),
    description: str = Form(""),
    job_type: str = Form(""),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    ext = os.path.splitext(file.filename)[1]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(RESUME_DIR, stored_name)
    with open(dest, "wb") as f:
        f.write(await file.read())
    new_id = db.insert_resume(name, date, description, stored_name, file.filename, job_type)
    return {"id": new_id}


@app.get("/api/resumes/{resume_id}/file")
def get_resume_file(resume_id: int):
    row = db.get_resume(resume_id)
    if not row:
        raise HTTPException(status_code=404, detail="Resume not found")
    path = os.path.join(RESUME_DIR, row["filename"])
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(path, media_type="application/pdf", filename=row["original_name"] or row["filename"])


@app.delete("/api/resumes/{resume_id}")
def delete_resume(resume_id: int):
    filename = db.delete_resume(resume_id)
    if filename is None:
        raise HTTPException(status_code=404, detail="Resume not found")
    path = os.path.join(RESUME_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}


@app.get("/api/scraper-log")
def get_scraper_log():
    df = db.get_scraper_logs()
    return df_to_records(df)


def _state_counts(df: pd.DataFrame) -> dict:
    states = []
    for locs in df['locations']:
        if isinstance(locs, list):
            for loc in locs:
                if isinstance(loc, dict) and loc.get('state'):
                    states.append(loc['state'])
    return pd.Series(states).value_counts().to_dict() if states else {}


@app.get("/api/analytics")
def get_analytics():
    df = db.get_job_applications()
    if df.empty:
        return {"empty": True, "total": 0}

    result = {
        "empty": False,
        "total": len(df),
        "by_status": df["status"].value_counts().to_dict(),
        "by_job_type": df["job_type"].fillna("Unknown").value_counts().to_dict(),
        "by_source": df["job_source"].fillna("Unknown").value_counts().to_dict(),
        "by_company": df["company"].value_counts().head(15).to_dict(),
        "by_state": _state_counts(df),
        "remote_count": int((df["work_arrangement"] == "remote").sum()),
        "hybrid_count": int((df["work_arrangement"] == "hybrid").sum()),
        "onsite_count": int(((df["work_arrangement"] == "onsite") | df["work_arrangement"].isna()).sum()),
    }

    time_df = df[df["date_applied"].notna()].copy()
    if not time_df.empty:
        time_df["date_applied"] = pd.to_datetime(time_df["date_applied"])
        time_df["week"] = time_df["date_applied"].dt.to_period("W").apply(
            lambda r: r.end_time.strftime("%Y-%m-%d")
        )
        weekly = time_df.groupby("week").size().reset_index(name="count")
        weekly["cumulative"] = weekly["count"].cumsum()
        result["weekly"] = weekly.to_dict(orient="records")
    else:
        result["weekly"] = []

    sal_df = df[(df["salary_min"].notna()) | (df["salary_max"].notna())].copy()
    if not sal_df.empty:
        sal_df["salary_mid"] = sal_df.apply(
            lambda r: (
                (r["salary_min"] + r["salary_max"]) / 2
                if pd.notna(r["salary_min"]) and pd.notna(r["salary_max"])
                else r["salary_min"] if pd.notna(r["salary_min"])
                else r["salary_max"]
            ),
            axis=1,
        )
        result["salary"] = {
            "median": float(sal_df["salary_mid"].median()),
            "min": float(sal_df["salary_min"].dropna().min()) if sal_df["salary_min"].notna().any() else None,
            "max": float(sal_df["salary_max"].dropna().max()) if sal_df["salary_max"].notna().any() else None,
            "data": sal_df[["salary_mid", "job_type"]].dropna().rename(
                columns={"salary_mid": "value", "job_type": "type"}
            ).to_dict(orient="records"),
        }
    else:
        result["salary"] = None

    return result


@app.get("/api/discovery/stream")
def discovery_stream():
    def _generate():
        for event in discovery.run_discovery():
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/discovery/jobs")
def list_discovered_jobs():
    df = db.get_discovered_jobs()
    return df_to_records(df)


@app.get("/api/discovery/runs")
def list_discovery_runs():
    return db.get_scrape_runs()


@app.get("/api/discovery/runs/latest")
def latest_discovery_run():
    return db.get_latest_scrape_run() or {}


@app.post("/api/discovery/jobs/{job_id}/dismiss")
def dismiss_discovered_job(job_id: int):
    db.dismiss_discovered_job(job_id)
    return {"ok": True}


@app.post("/api/discovery/jobs/{job_id}/tags")
def set_discovered_job_tags(job_id: int, body: DiscoveredJobTags):
    tags = sorted({t.strip() for t in body.tags if t.strip()})
    db.update_discovered_job_tags(job_id, tags)
    return {"ok": True, "tags": tags}


@app.get("/api/discovery/analyst-stream")
def discovery_analyst_stream():
    def _generate():
        for event in discovery.run_analyst_discovery():
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/discovery/save-todo", status_code=201)
def discovery_save_todo(body: DiscoverySaveTodo):
    data = body.dict()
    discovered_job_id = data.pop("discovered_job_id", None)
    data = scraper.rescrape_preserving_date_posted(data)
    new_id = db.insert_todo_application(data)
    if discovered_job_id:
        db.dismiss_discovered_job(discovered_job_id)
    return {"id": new_id}


@app.post("/api/discovery/save-applied", status_code=201)
def discovery_save_applied(body: DiscoverySaveApplied):
    data = body.dict()
    discovered_job_id = data.pop("discovered_job_id", None)
    data = scraper.rescrape_preserving_date_posted(data)
    new_id = db.insert_job_application(data)
    if discovered_job_id:
        db.dismiss_discovered_job(discovered_job_id)
    return {"id": new_id}
