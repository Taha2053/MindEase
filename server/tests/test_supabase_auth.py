import pytest
from fastapi import HTTPException

from api.auth import current_user


@pytest.mark.asyncio
async def test_local_mode_allows_no_account(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert await current_user(None) is None


@pytest.mark.asyncio
async def test_production_requires_account(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(HTTPException) as exc:
        await current_user(None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_malformed_authorization(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(HTTPException) as exc:
        await current_user("Token invalid")
    assert exc.value.status_code == 401
