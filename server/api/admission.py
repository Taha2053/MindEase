"""Shared admission control for paper and document generation."""

from datetime import timedelta

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from db import queries
from db.queries import _utcnow_naive
from .throttle import (
    client_ip, daily_cap_verdict, enforce_all, global_window_seconds,
    global_window_verdict, ip_fingerprint, per_ip_daily_limiter, per_ip_limiter,
    request_context,
)
from .turnstile import turnstile_cdata, verify_turnstile_detailed


async def admit_processing(source_id: str, token: str | None, request: Request, db: AsyncSession) -> str:
    now = _utcnow_naive()
    started_today = await queries.count_jobs_created_since(db, now.replace(hour=0, minute=0, second=0, microsecond=0))
    exhausted, retry_after = daily_cap_verdict(started_today, now)
    if exhausted:
        raise HTTPException(status_code=429,
                            detail="Daily capacity for new documents is used up. Try again tomorrow.",
                            headers={"Retry-After": str(retry_after)})
    started_recently = await queries.count_jobs_created_since(db, now - timedelta(seconds=global_window_seconds()))
    saturated, retry_after = global_window_verdict(started_recently)
    if saturated:
        raise HTTPException(status_code=429,
                            detail="The service is at capacity for new documents right now. Try again later.",
                            headers={"Retry-After": str(retry_after)})
    ip = client_ip(request)
    verdict = await verify_turnstile_detailed(token, ip, expected_cdata=turnstile_cdata(source_id))
    if not verdict.ok:
        raise HTTPException(status_code=403, detail="Human verification failed. Reload the page and try again.")
    fingerprint = ip_fingerprint(ip)
    enforce_all([
        (per_ip_limiter, ip, "Rate limit reached for starting new documents. Try again later."),
        (per_ip_daily_limiter, ip, "You've started today's share of documents from this address. Try again tomorrow."),
    ], client_tag=f"{fingerprint} {request_context(request)}")
    return fingerprint
