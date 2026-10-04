"""Private document ownership; public arXiv papers remain shareable."""

import hmac
import os

from fastapi import Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import DocumentAccess
from .auth import current_user


def is_document(source_id: str) -> bool:
    return source_id.startswith(("doc_", "wiki_", "pdf_"))


async def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    return await current_user(authorization) if authorization else None


def owns_document(owner: str | None, user: dict | None) -> bool:
    if owner is not None:
        return user is not None and user.get("id") == owner
    return os.getenv("ENVIRONMENT", "development").lower() == "development"


async def document_access(db: AsyncSession, source_id: str, user: dict | None,
                          media_token: str | None = None) -> DocumentAccess | None:
    if not is_document(source_id):
        return None
    access = await db.get(DocumentAccess, source_id)
    if access and media_token and hmac.compare_digest(access.media_token.encode(), media_token.encode()):
        return access
    if access and owns_document(access.owner_id, user):
        return access
    # Older local prototype documents have no ownership record. Never publish
    # these records when the same database is moved to a hosted environment.
    if access is None and owns_document(None, user):
        return None
    raise HTTPException(status_code=404, detail="Document not found")
