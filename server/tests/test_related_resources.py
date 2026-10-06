import json
import httpx
import pytest
from fastapi import FastAPI

from api.auth import current_user
from api.routes import router
from services import related_resources


@pytest.mark.asyncio
async def test_tavily_search_filters_unsafe_results_and_prefers_illustrated_pages(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-only")

    def reply(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-only"
        body = json.loads(request.content)
        assert body["search_depth"] == "basic"
        assert body["include_images"] is True
        assert "photosynthesis" in body["query"]
        return httpx.Response(200, json={"results": [
            {"title": "Text lesson", "url": "https://example.edu/text", "content": "Readable lesson"},
            {"title": "Private address", "url": "https://127.0.0.1/secret"},
            {"title": "Illustrated lesson", "url": "https://example.edu/visual", "images": ["https://example.edu/image.png"]},
            {"title": "Source page", "url": "https://source.edu/article"},
        ]})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(related_resources.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(reply)))
    result = await related_resources.search_related_resources(["photosynthesis"], "visual", "https://source.edu/article")
    assert [item["title"] for item in result] == ["Illustrated lesson", "Text lesson"]
    assert all("illustrated" not in item for item in result)


@pytest.mark.asyncio
async def test_related_resource_route_validates_topics_and_returns_results(monkeypatch):
    async def search(topics, preference, source_url):
        assert (topics, preference, source_url) == (["Photosynthesis"], "text", "https://source.edu/article")
        return [{"title": "Lesson", "url": "https://example.edu/lesson", "description": "", "reason": "Related"}]

    monkeypatch.setattr("api.routes.search_related_resources", search)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: {"sub": "learner"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/resources/related", json={"topics": ["Photosynthesis"], "preference": "text", "source_url": "https://source.edu/article"})
        assert response.status_code == 200
        assert response.json()["resources"][0]["url"] == "https://example.edu/lesson"
        invalid = await client.post("/api/resources/related", json={"topics": ["  "], "preference": "text"})
        assert invalid.status_code == 422


@pytest.mark.asyncio
async def test_multiple_topics_fire_parallel_searches(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-only")
    queries_seen: list[str] = []

    def reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        queries_seen.append(body["query"])
        return httpx.Response(200, json={"results": [
            {"title": f"Result for {body['query'][:10]}", "url": f"https://example.edu/{len(queries_seen)}",
             "content": "Content", "score": 0.8},
        ]})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(related_resources.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(reply)))
    result = await related_resources.search_related_resources(["Photosynthesis", "Chloroplast"], "text", "")
    assert len(queries_seen) == 2
    assert any("Photosynthesis" in q for q in queries_seen)
    assert any("Chloroplast" in q for q in queries_seen)
    assert len(result) == 2


@pytest.mark.asyncio
async def test_canonical_dedup_excludes_fragment_variants(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-only")

    def reply(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [
            {"title": "Page", "url": "https://example.edu/lesson", "content": "A", "score": 0.9},
            {"title": "Page dup", "url": "https://example.edu/lesson/", "content": "B", "score": 0.8},
            {"title": "Page frag", "url": "https://example.edu/lesson#section", "content": "C", "score": 0.7},
            {"title": "Other", "url": "https://example.edu/other", "content": "D", "score": 0.6},
        ]})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(related_resources.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(reply)))
    result = await related_resources.search_related_resources(["Topic"], "text", "")
    urls = [item["url"] for item in result]
    lesson_urls = [u for u in urls if "lesson" in u]
    assert len(lesson_urls) == 1
    assert any("other" in u for u in urls)


@pytest.mark.asyncio
async def test_source_url_excluded_despite_fragment_difference(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-only")

    def reply(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [
            {"title": "Source clone", "url": "https://source.edu/article#refs", "content": "Same page"},
            {"title": "Different", "url": "https://other.edu/page", "content": "Other page"},
        ]})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(related_resources.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(reply)))
    result = await related_resources.search_related_resources(["Topic"], "text", "https://source.edu/article")
    assert len(result) == 1
    assert result[0]["title"] == "Different"


@pytest.mark.asyncio
async def test_missing_tavily_key_raises_runtime_error():
    import os
    os.environ.pop("TAVILY_API_KEY", None)
    with pytest.raises(RuntimeError, match="not configured"):
        await related_resources.search_related_resources(["Topic"], "text", "")
