"""Local UI server for the Asian Cinema Video Essay pipeline.

Run: python server.py
Open: http://127.0.0.1:8787
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
UPLOADS = ROOT / "uploads"
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()

STEPS = [
    ("source", "Source & timeline", "Create a legal-source workspace, proxy and scene timeline."),
    ("research", "Evidence research", "Build claims, scene evidence and counter-arguments."),
    ("script", "Thesis & script", "Write the English video essay from approved evidence."),
    ("audio", "Voice production", "Generate sectioned narration with the selected Vibi voice."),
    ("avatar", "Host production", "Render selected host segments with InfiniteTalk."),
    ("edit", "Edit & QC", "Assemble evidence, captions and run copyright/quality checks."),
]


def make_job(payload: dict) -> dict:
    source = payload.get("source") or {}
    source_id = str(source.get("id", "")).strip()
    source_name = str(source.get("name", "")).strip()
    if not source_id or not source_name or not (UPLOADS / source_id).is_file():
        raise ValueError("A movie source file must be uploaded first.")
    title = Path(source_name).stem.replace("_", " ").replace(".", " ")
    job_id = uuid.uuid4().hex[:8]
    duration = int(payload.get("duration", 9))
    host = payload.get("host", "aya")
    angle = str(payload.get("angle", "")).strip()
    job = {
        "id": job_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "filmTitle": title,
        "source": {"id": source_id, "name": source_name, "size": int(source.get("size", 0))},
        "angle": angle,
        "duration": duration,
        "host": host,
        "status": "running",
        "progress": 2,
        "activeStep": 0,
        "steps": [
            {"id": step_id, "title": label, "description": description, "status": "pending", "artifact": None}
            for step_id, label, description in STEPS
        ],
        "result": None,
    }
    job["steps"][0]["status"] = "running"
    return job


def process_job(job_id: str) -> None:
    for index, (step_id, label, _) in enumerate(STEPS):
        with LOCK:
            job = JOBS[job_id]
            job["activeStep"] = index
            job["steps"][index]["status"] = "running"
            job["progress"] = max(job["progress"], index * 16 + 7)
        time.sleep(1.25)
        with LOCK:
            job = JOBS[job_id]
            title = job["filmTitle"]
            duration = job["duration"]
            job["steps"][index]["status"] = "complete"
            job["steps"][index]["artifact"] = artifact_for(step_id, title, duration, job["angle"])
            job["progress"] = min(96, (index + 1) * 16)
            if index + 1 < len(STEPS):
                job["steps"][index + 1]["status"] = "running"
    with LOCK:
        job = JOBS[job_id]
        job["progress"] = 100
        job["status"] = "complete"
        job["result"] = result_for(job)


def artifact_for(step_id: str, title: str, duration: int, angle: str) -> str:
    artifacts = {
        "source": f"{title} source ingested · proxy plan · scene timeline schema",
        "research": "evidence ledger · 8 scene slots · counter-reading",
        "script": f"{duration}-minute English script outline" + (f" · {angle}" if angle else ""),
        "audio": "Vibi narration segments · intro / 3 arguments / verdict",
        "avatar": "InfiniteTalk host shots · 5 clips × 15–35 seconds",
        "edit": "edit decision list · captions · rights/QC checklist",
    }
    return artifacts[step_id]


def result_for(job: dict) -> dict:
    title = job["filmTitle"]
    question = job["angle"] or f"What is {title} really asking its audience to believe?"
    return {
        "headline": f"{title}: the argument beneath the story",
        "question": question,
        "runtime": f"{job['duration']} min target · 5 host inserts · 8 evidence moments",
        "nextAction": "Attach a lawfully obtained source/proxy and subtitle file before final render.",
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if self.path != "/api/jobs":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(size))
            job = make_job(payload)
            with LOCK:
                JOBS[job["id"]] = job
            threading.Thread(target=process_job, args=(job["id"],), daemon=True).start()
            self.send_json(HTTPStatus.CREATED, job)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def do_PUT(self):
        if not self.path.startswith("/api/uploads/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        file_id = self.path.rsplit("/", 1)[-1]
        if not file_id or any(char not in "0123456789abcdef" for char in file_id):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid upload id."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1:
                raise ValueError("Empty source file.")
            UPLOADS.mkdir(exist_ok=True)
            destination = UPLOADS / file_id
            remaining = length
            with destination.open("wb") as handle:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Upload ended unexpectedly.")
                    handle.write(chunk)
                    remaining -= len(chunk)
            self.send_json(HTTPStatus.CREATED, {"id": file_id, "bytes": length})
        except (ValueError, OSError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def do_GET(self):
        if self.path.startswith("/api/jobs/"):
            job_id = self.path.rsplit("/", 1)[-1]
            with LOCK:
                job = JOBS.get(job_id)
            if not job:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Job not found."})
                return
            self.send_json(HTTPStatus.OK, job)
            return
        return super().do_GET()

    def send_json(self, status: HTTPStatus, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    print("Cinema pipeline UI: http://127.0.0.1:8787")
    ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
