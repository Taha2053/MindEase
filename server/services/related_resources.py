"""Find real educational pages without exposing the search credential to the extension."""

import asyncio
import ipaddress
import os
from urllib.parse import urlsplit, urlunsplit

import httpx


_MAX_CONCURRENT_SEARCHES = 3
_MAX_RESULTS_PER_QUERY = 8
_FINAL_RESULTS = 6


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


def _canonical_url(url: str) -> str:
    """Normalize URL for dedup: strip fragment, trailing slash on path, lowercase host."""
    try:
        parts = urlsplit(url)
        path = parts.path.rstrip("/") or "/"
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(),
                           path, parts.query, ""))
    except Exception:
        return url


def _source_matches(candidate_url: str, source_url: str) -> bool:
    """True when candidate is the same page as source (ignoring fragment)."""
    if not source_url:
        return False
    return _canonical_url(candidate_url) == _canonical_url(source_url)


async def _tavily_search(client: httpx.AsyncClient, key: str, query: str,
                         include_images: bool) -> list[dict]:
    """Single Tavily search call."""
    response = await client.post(
        "https://api.tavily.com/search",
        headers={"Authorization": f"Bearer {key}"},
        json={"query": query, "search_depth": "basic",
              "max_results": _MAX_RESULTS_PER_QUERY,
              "include_images": include_images, "include_answer": False},
    )
    response.raise_for_status()
    return response.json().get("results", [])


async def search_related_resources(topics: list[str], preference: str,
                                   source_url: str) -> list[dict[str, str]]:
    """Search for related educational resources using multiple topics.

    Fires parallel Tavily searches (one per topic, bounded), merges
    results, deduplicates by canonical URL, excludes the source page,
    and ranks by search relevance score.
    """
    key = os.getenv("TAVILY_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Tavily search is not configured")

    include_images = preference == "visual"
    suffix = "illustrated explanation diagram tutorial" if include_images else "educational explanation tutorial"

    queries = [f"{topic} {suffix}" for topic in dict.fromkeys(topics)][: _MAX_CONCURRENT_SEARCHES]

    async with httpx.AsyncClient(timeout=15.0) as client:
        tasks = [_tavily_search(client, key, q, include_images) for q in queries]
        settled = await asyncio.gather(*tasks, return_exceptions=True)

    # Merge all hits from successful searches.
    all_hits: list[tuple[float, dict]] = []
    for batch in settled:
        if isinstance(batch, BaseException):
            continue
        for hit in batch:
            if not isinstance(hit, dict):
                continue
            score = hit.get("score", 0.0)
            if not isinstance(score, (int, float)):
                score = 0.0
            all_hits.append((float(score), hit))

    # Sort by relevance score descending before dedup so the best variant wins.
    all_hits.sort(key=lambda item: -item[0])

    seen: set[str] = set()
    results: list[tuple[bool, float, dict[str, str]]] = []
    for score, hit in all_hits:
        raw_url = hit.get("url")
        url = public_https_url(raw_url) if isinstance(raw_url, str) else None
        if not url or _source_matches(url, source_url):
            continue
        canon = _canonical_url(url)
        if canon in seen:
            continue
        title = hit.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        seen.add(canon)
        images = hit.get("images")
        illustrated = isinstance(images, list) and bool(images)
        description = hit.get("content")
        results.append((illustrated, score, {
            "title": title.strip()[:200], "url": url,
            "description": description.strip()[:450] if isinstance(description, str) else "",
            "reason": ("Search indexed images on this page; inspect whether its visuals are useful."
                       if illustrated else "Related educational search result; inspect the page before studying it."),
        }))

    if preference == "visual":
        results.sort(key=lambda item: (-int(item[0]), -item[1]))

    # Prefer different sites without discarding useful same-site results when coverage is sparse.
    chosen: list[dict[str, str]] = []
    deferred: list[dict[str, str]] = []
    hosts: set[str] = set()
    for _, _, item in results:
        host = urlsplit(item["url"]).hostname or ""
        if host in hosts:
            deferred.append(item)
        else:
            hosts.add(host)
            chosen.append(item)
    return (chosen + deferred)[:_FINAL_RESULTS]
