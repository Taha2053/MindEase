"""Supabase bearer-token verification for hosted premium endpoints."""

import os

import httpx
from fastapi import Header, HTTPException


def auth_required() -> bool:
    return os.getenv("ENVIRONMENT", "development").lower() == "production"


async def current_user(authorization: str | None = Header(default=None)) -> dict | None:
    """Require a valid Supabase session in production; permit local prototype use."""
    if not authorization:
        if auth_required():
            raise HTTPException(status_code=401, detail="Authentication required")
        return None
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")).rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Authentication service is not configured")
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{url}/auth/v1/user",
            headers={"apikey": key, "Authorization": authorization},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = response.json()
    if not user.get("id"):
        raise HTTPException(status_code=401, detail="Invalid session")
    return user
