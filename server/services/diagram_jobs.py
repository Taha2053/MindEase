"""Short polling requests keep long diagram generation outside extension workers."""
import asyncio
import time
import uuid
import httpx
from fastapi import HTTPException
from services.napkin import generate_diagram

_jobs: dict[str, dict] = {}
_tasks: set[asyncio.Task] = set()


def start_diagram(content: str, label: str, profile: dict, owner: str | None) -> str:
    now = time.monotonic()
    for key in list(_jobs):
        if _jobs[key]["expires"] < now:
            del _jobs[key]
    if len(_jobs) >= 100:
        raise HTTPException(status_code=503, detail="Diagram queue is busy. Try again shortly.")
    job_id = uuid.uuid4().hex
    job = {"owner": owner, "expires": now + 1800, "status": "processing"}
    _jobs[job_id] = job

    async def run():
        try:
            async with asyncio.timeout(600):
                job["result"] = await generate_diagram(content, label, profile)
            job["status"] = "completed"
        except httpx.HTTPStatusError as exc:
            job["status"] = "failed"
            job["error"] = {401: "Napkin rejected the configured API token.", 403: "Napkin denied access. Check API access and credits.", 429: "Napkin rate limit reached. Try again shortly."}.get(exc.response.status_code, f"Diagram provider returned HTTP {exc.response.status_code}.")
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = (str(exc) if isinstance(exc, (ValueError, RuntimeError)) else
                            f"Diagram generation failed ({type(exc).__name__}). Check the server connection and provider access, then retry.")

    task = asyncio.create_task(run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job_id


def diagram_status(job_id: str, owner: str | None) -> dict:
    job = _jobs.get(job_id)
    if not job or job["owner"] != owner or job["expires"] < time.monotonic():
        raise HTTPException(status_code=404, detail="Diagram job expired or the server restarted. Generate it again.")
    return {key: value for key, value in job.items() if key in ("status", "result", "error")}
