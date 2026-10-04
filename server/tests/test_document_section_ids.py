import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from db.models import Base, Section
from jobs.worker import _store_structured_paper
from models.paper import ArxivPaperMeta, StructuredPaper, Section as SourceSection


@pytest.mark.asyncio
async def test_documents_with_identical_local_section_ids_are_both_stored():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        for paper_id in ("first", "second"):
            paper = StructuredPaper(meta=ArxivPaperMeta(arxiv_id=paper_id, title=paper_id, authors=[], abstract="", pdf_url=f"https://example.org/{paper_id}.pdf"), sections=[SourceSection(id="sec-1", title="Overview", content="Original material", level=1)])
            await _store_structured_paper(db, "missing-job", paper)
            assert paper.sections[0].id == f"{paper_id}:sec-1"
        sections = (await db.execute(select(Section))).scalars().all()
        assert {section.id for section in sections} == {"first:sec-1", "second:sec-1"}
    await engine.dispose()
