"""
Generalized Document Ingest for MindEase & arXivisual.
Handles arbitrary web pages, Wikipedia articles, uploaded/online PDFs,
and pre-parsed sections from the MindEase browser extension.
"""

import hashlib
import io
import logging
import re
from datetime import datetime
from typing import Any

import httpx
from bs4 import BeautifulSoup

from ingestion.pdf_parser import parse_pdf
from ingestion.section_extractor import extract_sections
from models.paper import (
    ArxivPaperMeta,
    Equation,
    Figure,
    ParsedContent,
    Section,
    StructuredPaper,
    Table,
)

logger = logging.getLogger(__name__)


def generate_document_id(title: str, url: str | None = None) -> str:
    """Generate a clean, deterministic document identifier."""
    key = url.strip() if url and url.strip() else title.strip()
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
    # Clean prefix based on source
    if url and "wikipedia.org" in url:
        return f"wiki_{digest}"
    if url and url.lower().endswith(".pdf"):
        return f"pdf_{digest}"
    return f"doc_{digest}"


async def ingest_document(
    title: str,
    source_type: str = "website",
    url: str | None = None,
    abstract: str | None = None,
    content: str | None = None,
    sections_input: list[dict[str, Any]] | None = None,
) -> StructuredPaper:
    """
    Ingest a document from pre-parsed sections, raw markdown/text, or remote URL.
    Returns a StructuredPaper compatible with the multi-agent Manim generation pipeline.
    """
    doc_id = generate_document_id(title, url)
    logger.info("Ingesting document %s (title=%r, type=%s)", doc_id, title, source_type)

    sections: list[Section] = []

    # Case 1: Pre-parsed sections passed directly from MindEase extension
    if sections_input and len(sections_input) > 0:
        logger.info("Using %d pre-parsed sections from MindEase extension", len(sections_input))
        for idx, s in enumerate(sections_input):
            sec_id = s.get("id") or f"section-{idx + 1}"
            sec_title = s.get("title") or f"Section {idx + 1}"
            sec_content = s.get("content") or ""
            sec_summary = s.get("summary") or (sec_content[:200] + "..." if len(sec_content) > 200 else sec_content)
            level = s.get("level", 1)

            # Extract equations from content if none passed
            eq_strings = s.get("equations") or []
            equations: list[Equation] = []
            for eq_str in eq_strings:
                equations.append(Equation(latex=eq_str, is_inline=False))

            # Auto-detect equations if empty
            if not equations and ("=" in sec_content or "\\" in sec_content):
                math_matches = re.findall(r"\$\$([^\$]+)\$\$|\\\[([^\]]+)\\\]|\[FORMULA\]([^\[]+)\[/FORMULA\]", sec_content)
                for m in math_matches:
                    latex = next(item for item in m if item)
                    if latex:
                        equations.append(Equation(latex=latex.strip(), is_inline=False))

            sections.append(
                Section(
                    id=sec_id,
                    title=sec_title,
                    level=level,
                    content=sec_content,
                    summary=sec_summary,
                    equations=equations,
                    figures=[],
                    tables=[],
                )
            )

    # Case 2: Remote PDF document URL
    elif url and (url.lower().endswith(".pdf") or source_type == "pdf"):
        logger.info("Fetching remote PDF from %s", url)
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            parsed_content = parse_pdf(resp.content)
            sections = extract_sections(parsed_content)

    # Case 3: Remote Wikipedia or Web Article
    elif url and not content:
        logger.info("Fetching web article from %s", url)
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={"User-Agent": "MindEase-Research-Visualizer/1.0 (Educational)"},
            )
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "lxml" if "lxml" in BeautifulSoup.__dict__ else "html.parser")

            # Extract clean title if empty
            if not title and soup.title:
                title = soup.title.get_text().strip()

            # Target main article container
            main_node = (
                soup.find("div", {"id": "mw-content-text"})  # Wikipedia
                or soup.find("article")                       # Standard blog / news
                or soup.find("main")
                or soup.body
            )

            # Strip script, style, nav, footer boilerplate
            if main_node:
                for tag in main_node.find_all(["script", "style", "nav", "footer", "aside", "header"]):
                    tag.decompose()

                # Parse headings into sections
                headings = main_node.find_all(["h1", "h2", "h3"])
                if headings:
                    current_title = "Overview"
                    current_lines = []
                    current_level = 1

                    for element in main_node.find_all(["h1", "h2", "h3", "p", "pre", "blockquote"]):
                        if element.name in ["h1", "h2", "h3"]:
                            if current_lines:
                                text_body = "\n\n".join(current_lines).strip()
                                if len(text_body) > 80:
                                    sections.append(
                                        Section(
                                            id=f"sec-{len(sections) + 1}",
                                            title=current_title,
                                            level=current_level,
                                            content=text_body,
                                            summary=text_body[:250] + "...",
                                        )
                                    )
                            current_title = element.get_text().strip()
                            current_level = int(element.name[1])
                            current_lines = []
                        elif element.name in ["p", "pre", "blockquote"]:
                            text = element.get_text().strip()
                            if text:
                                current_lines.append(text)

                    # Append trailing section
                    if current_lines:
                        text_body = "\n\n".join(current_lines).strip()
                        if len(text_body) > 80:
                            sections.append(
                                Section(
                                    id=f"sec-{len(sections) + 1}",
                                    title=current_title,
                                    level=current_level,
                                    content=text_body,
                                    summary=text_body[:250] + "...",
                                )
                            )
                else:
                    # Fallback single section
                    full_text = main_node.get_text().strip()
                    sections.append(
                        Section(
                            id="sec-1",
                            title=title or "Overview",
                            level=1,
                            content=full_text,
                            summary=full_text[:300] + "...",
                        )
                    )

    # Case 4: Raw text or Markdown passed in payload
    elif content:
        logger.info("Parsing raw text content (%d chars)", len(content))
        # Split on Markdown headers #, ##, ###
        header_splits = re.split(r"(?m)^(#{1,3}\s+[^\n]+)$", content)
        if len(header_splits) > 1:
            current_title = "Introduction"
            current_level = 1
            idx = 0
            while idx < len(header_splits):
                chunk = header_splits[idx].strip()
                if re.match(r"^#{1,3}\s+", chunk):
                    level = chunk.count("#", 0, 4)
                    current_title = re.sub(r"^#{1,3}\s+", "", chunk).strip()
                    current_level = level
                    body = header_splits[idx + 1].strip() if idx + 1 < len(header_splits) else ""
                    if body:
                        sections.append(
                            Section(
                                id=f"sec-{len(sections) + 1}",
                                title=current_title,
                                level=current_level,
                                content=body,
                                summary=body[:250] + "...",
                            )
                        )
                    idx += 2
                else:
                    if chunk:
                        sections.append(
                            Section(
                                id=f"sec-{len(sections) + 1}",
                                title="Overview",
                                level=1,
                                content=chunk,
                                summary=chunk[:250] + "...",
                            )
                        )
                    idx += 1
        else:
            sections.append(
                Section(
                    id="sec-1",
                    title=title or "Overview",
                    level=1,
                    content=content,
                    summary=content[:250] + "...",
                )
            )

    # Ensure at least one section exists
    if not sections:
        sections.append(
            Section(
                id="sec-1",
                title=title or "Overview",
                level=1,
                content=abstract or "Educational content overview.",
                summary=abstract or "Educational content overview.",
            )
        )

    # Build paper meta
    meta = ArxivPaperMeta(
        arxiv_id=doc_id,
        title=title,
        authors=[source_type.capitalize(), "MindEase"],
        abstract=abstract or (sections[0].content[:400] if sections else "No abstract provided."),
        published=datetime.utcnow(),
        updated=datetime.utcnow(),
        categories=[source_type],
        pdf_url=url or f"https://mindease.local/{doc_id}",
        html_url=url,
    )

    return StructuredPaper(meta=meta, sections=sections)
