"""Find real educational pages without exposing the search credential to the extension."""

import ipaddress
import os
from urllib.parse import urlsplit

import httpx


def public_https_url(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        if parsed.scheme != "https" or not hostname or parsed.username or parsed.password:
            return None
        if hostname.lower() == "localhost" or hostname.lower().endswith(".localhost"):
            return None
        try:
            if not ipaddress.ip_address(hostname).is_global:
                return None
        except ValueError:
            pass
        return value
    except ValueError:
        return None


async def search_related_resources(topic: str, preference: str, source_url: str) -> list[dict[str, str]]:
    key = os.getenv("TAVILY_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Tavily search is not configured")

    query = f"{topic} educational explanation tutorial"
    if preference == "visual":
        query = f"{topic} illustrated explanation diagram tutorial"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            "https://api.tavily.com/search",
            headers={"Authorization": f"Bearer {key}"},
            json={"query": query, "search_depth": "basic", "max_results": 8,
                  "include_images": preference == "visual", "include_answer": False},
        )
        response.raise_for_status()
        data = response.json()

    results: list[tuple[bool, dict[str, str]]] = []
    seen: set[str] = set()
    for hit in data.get("results", []):
        if not isinstance(hit, dict):
            continue
        url = public_https_url(hit.get("url", "")) if isinstance(hit.get("url"), str) else None
        if not url or url == source_url or url in seen:
            continue
        title = hit.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        seen.add(url)
        images = hit.get("images")
        illustrated = isinstance(images, list) and bool(images)
        description = hit.get("content")
        results.append((illustrated, {
            "title": title.strip()[:200], "url": url,
            "description": description.strip()[:450] if isinstance(description, str) else "",
            "reason": ("Search indexed images on this page; inspect whether its visuals are useful."
                       if illustrated else "Related educational search result; inspect the page before studying it."),
        }))
    if preference == "visual":
        results.sort(key=lambda item: not item[0])
    return [item for _, item in results[:4]]
