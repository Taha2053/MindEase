"""Integration tests for document access boundaries and admission controls."""

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import api.admission as admission_module
import api.routes as routes_module
import api.throttle as throttle
import api.turnstile as turnstile
from api.routes import router
from db.connection import get_db
from db.models import Base, DocumentAccess, Paper, ProcessingJob


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db, monkeypatch):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(routes_module, "process_paper_job", _noop)
    monkeypatch.setattr("jobs.process_document_job", _noop)
    monkeypatch.delenv("USE_TEMPORAL", raising=False)
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
    monkeypatch.setenv("DAILY_NEW_PAPER_CAP", "0")
    monkeypatch.setenv("RATE_LIMIT_PROCESS_GLOBAL", "100")
    for lim in (throttle.per_ip_limiter, throttle.per_ip_daily_limiter):
        lim.reset()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_document_processing_enforces_turnstile(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret")

    async def fake_verify(token, remote_ip=None, *, expected_cdata=None):
        return turnstile.TurnstileVerdict(token == "valid-token", None, 1.0)

    monkeypatch.setattr(admission_module, "verify_turnstile_detailed", fake_verify)

    rejected = await client.post("/api/process/document", json={
        "title": "Private study guide",
        "content": "Secret notes",
        "turnstile_token": "forged",
    })
    assert rejected.status_code == 403

    accepted = await client.post("/api/process/document", json={
        "title": "Private study guide",
        "content": "Secret notes",
        "turnstile_token": "valid-token",
    })
    assert accepted.status_code == 200
    assert accepted.json()["arxiv_id"].startswith("doc_")


@pytest.mark.asyncio
async def test_private_document_hidden_from_other_users(client, db, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    doc_id = "doc_private_learning_target"
    db.add(DocumentAccess(document_id=doc_id, owner_id="user-a", media_token="media-token-123"))
    db.add(Paper(id=doc_id, title="Private Document", abstract="Secret content", authors=["Learner"]))
    db.add(ProcessingJob(id="job_private_1", paper_id=doc_id, status="completed", progress=1.0))
    await db.commit()

    # User B cannot see the paper
    user_b_headers = {"Authorization": "Bearer mock-user-b"}

    async def fake_current_user(authorization=None):
        if authorization == "Bearer mock-user-a":
            return {"id": "user-a", "email": "a@example.org"}
        if authorization == "Bearer mock-user-b":
            return {"id": "user-b", "email": "b@example.org"}
        return None

    monkeypatch.setattr("api.routes.current_user", fake_current_user)
    monkeypatch.setattr("api.document_access.current_user", fake_current_user)

    hidden = await client.get(f"/api/paper/{doc_id}", headers=user_b_headers)
    assert hidden.status_code == 404

    listed = await client.get("/api/papers", headers=user_b_headers)
    assert doc_id not in [p["paper_id"] for p in listed.json()["papers"]]

    visible = await client.get(f"/api/paper/{doc_id}", headers={"Authorization": "Bearer mock-user-a"})
    assert visible.status_code == 200
    assert visible.json()["title"] == "Private Document"
