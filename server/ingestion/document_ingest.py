"""
Generalized Document Ingest for MindEase.
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
from bs4 import BeautifulSoup, NavigableString

from ingestion.pdf_parser import parse_pdf
from ingestion.section_extractor import extract_sections
from ingestion.remote_document import fetch_public_document
from models.paper import (
    ArxivPaperMeta,
    Equation,
    Figure,
    ParsedContent,
    Section,
    StructuredPaper,
    Table,
)

NONLESSON_HEADING_PATTERN = re.compile(
    r"^(references|bibliography|see also|further reading|external links|"
    r"related\s+(articles|posts|content)|recommended\s+(articles|reading)|"
    r"you may also like)$",
    re.IGNORECASE,
)

PROMO_LINK_PATTERN = re.compile(
    r"^(read\s+(also|more)|see\s+also|check\s+(out|more)|related\s+(articles|posts)|you\s+may\s+also\s+like)\b",
    re.IGNORECASE,
)

REMOVE_SELECTORS = [
    "script", "style", "noscript", "nav", "footer", "aside", "header", "form",
    "[hidden]", "[aria-hidden='true']",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    ".mw-editsection", ".mw-jump-link", ".noprint", ".navbox", ".vertical-navbox",
    ".sidebar", ".metadata", ".ambox", ".hatnote", ".shortdescription",
    ".mw-authority-control", ".catlinks", ".printfooter", ".sistersitebox",
    ".vector-page-toolbar", ".vector-dropdown", ".uls-language-list",
    ".reflist", ".references", ".refbegin", ".portal", ".citation",
    ".related-articles", ".related-posts", ".recommended-articles", "[data-related-content]",
    "[aria-label='Related articles']", "[aria-label='Recommended articles']",
    "button", "select", "input", "textarea",
]


def math_to_tex(element: Any) -> str:
    """Convert basic MathML elements to LaTeX."""
    name = getattr(element, "name", "").lower()
    children = [child for child in getattr(element, "children", []) if hasattr(child, "name")]
    parts = [math_to_tex(child) for child in children]
    if name in ("annotation", "annotation-xml"):
        return ""
    if name == "mfrac":
        num = parts[0] if len(parts) > 0 else ""
        den = parts[1] if len(parts) > 1 else ""
        return f"\\frac{{{num}}}{{{den}}}"
    if name == "msup":
        base = parts[0] if len(parts) > 0 else ""
        sup = parts[1] if len(parts) > 1 else ""
        return f"{{{base}}}^{{{sup}}}"
    if name == "msub":
        base = parts[0] if len(parts) > 0 else ""
        sub = parts[1] if len(parts) > 1 else ""
        return f"{{{base}}}_{{{sub}}}"
    if name == "msubsup":
        base = parts[0] if len(parts) > 0 else ""
        sub = parts[1] if len(parts) > 1 else ""
        sup = parts[2] if len(parts) > 2 else ""
        return f"{{{base}}}_{{{sub}}}^{{{sup}}}"
    if name == "msqrt":
        return f"\\sqrt{{{ ' '.join(p for p in parts if p) }}}"
    if name == "mroot":
        base = parts[0] if len(parts) > 0 else ""
        idx = parts[1] if len(parts) > 1 else ""
        return f"\\sqrt[{idx}]{{{base}}}"
    if parts:
        return " ".join(p for p in parts if p)
    return element.get_text().strip() if hasattr(element, "get_text") else ""


def preserve_math_in_soup(root: Any) -> None:
    """
    Preserve math elements before text extraction as [FORMULA]TeX[/FORMULA] exactly once.
    Finds outermost KaTeX, MathJax, MathML or Wikipedia math wrappers.
    """
    math_selectors = [
        ".mwe-math-element",
        ".katex-display",
        ".katex",
        "mjx-container",
        "math",
        "[data-tex]",
        "img.mwe-math-fallback-image",
    ]
    matched_elements = root.select(", ".join(math_selectors))
    for element in matched_elements:
        # Skip if element was already removed or replaced as part of an ancestor wrapper
        if element.parent is None:
            continue
        math = element if element.name == "math" else element.find("math")
        annotation = element.find("annotation", attrs={"encoding": "application/x-tex"})
        fallback = element if element.name == "img" else element.find("img", class_="mwe-math-fallback-image")

        tex = (
            element.get("data-tex")
            or (annotation.get_text().strip() if annotation else "")
            or (math.get("alttext", "").strip() if math and math.get("alttext") else "")
            or (fallback.get("alt", "").strip() if fallback and fallback.get("alt") else "")
            or (math_to_tex(math) if math else "")
        )
        tex = tex.strip()
        if tex:
            element.replace_with(f" [FORMULA]{tex}[/FORMULA] ")
        else:
            element.decompose()


def normalize_block_text(value: str) -> str:
    """Normalize whitespace within a block while preserving single line breaks."""
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in value.split("\n")]
    return "\n".join(lines).strip()


def format_table_markdown(table_elem: Any) -> str:
    """Convert an HTML table into a Markdown table."""
    rows = []
    for tr in table_elem.find_all("tr"):
        cells = [normalize_block_text(cell.get_text()).replace("|", "\\|") for cell in tr.find_all(["th", "td"])]
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    max_cols = max(len(r) for r in rows)
    if max_cols == 0:
        return ""
    # Pad shorter rows
    padded_rows = [r + [""] * (max_cols - len(r)) for r in rows]
    header = padded_rows[0]
    divider = ["---"] * max_cols
    table_lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(divider) + " |",
    ]
    for r in padded_rows[1:]:
        table_lines.append("| " + " | ".join(r) + " |")
    return "\n".join(table_lines)


def meaningful_block_text(elem: Any) -> str:
    """Convert an element into formatted Markdown text."""
    name = elem.name.lower()
    if re.match(r"^h[1-6]$", name):
        level = int(name[1])
        return "#" * level + " " + normalize_block_text(elem.get_text())
    if name == "li":
        return "- " + normalize_block_text(elem.get_text())
    if name == "pre":
        code = elem.get_text().strip()
        return f"```\n{code}\n```"
    if name == "table":
        return format_table_markdown(elem)
    return normalize_block_text(elem.get_text())


def filter_nonlesson_sections(sections: list[Section]) -> list[Section]:
    """
    Filter sections by nonlesson headings:
    Skip sections under references/bibliography/related until next same or higher heading.
    """
    filtered: list[Section] = []
    skipped_heading_level: int | None = None

    for sec in sections:
        title = sec.title.strip()
        title_clean = re.sub(r"^\d+(\.\d+)*\.?\s*", "", title).strip()
        title_normalized = re.sub(r"[:\s]+$", "", title_clean).strip().lower()
        level = getattr(sec, "level", 1) or 1

        if skipped_heading_level is not None:
            if level <= skipped_heading_level:
                skipped_heading_level = None
            else:
                continue

        if NONLESSON_HEADING_PATTERN.match(title_normalized):
            skipped_heading_level = level
            continue

        filtered.append(sec)

    return filtered


def extract_equations_from_content(content: str) -> list[Equation]:
    """Extract Equation objects from math delimiters and [FORMULA] tags."""
    math_matches = re.findall(
        r"\[FORMULA\]([\s\S]*?)\[/FORMULA\]|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<!\$)\$([^\$\n]+)\$(?!\$)",
        content,
    )
    equations: list[Equation] = []
    seen: set[str] = set()
    for m in math_matches:
        raw = next((item for item in m if item), "").strip()
        if raw and raw not in seen:
            seen.add(raw)
            equations.append(Equation(latex=raw, is_inline=False))
    return equations


def filter_markdown_sections(content: str) -> list[tuple[str, int, str]]:
    """
    Parse raw Markdown content into (title, level, body) tuples,
    filtering out nonlesson heading sections until next same or higher heading.
    """
    header_splits = re.split(r"(?m)^(#{1,6}\s+[^\n]+)$", content)
    raw_sections: list[tuple[str, int, str]] = []
    if len(header_splits) > 1:
        idx = 0
        while idx < len(header_splits):
            chunk = header_splits[idx].strip()
            if re.match(r"^#{1,6}\s+", chunk):
                m = re.match(r"^(#{1,6})\s+(.*)$", chunk)
                level = len(m.group(1)) if m else 1
                title = m.group(2).strip() if m else ""
                body = header_splits[idx + 1].strip() if idx + 1 < len(header_splits) else ""
                raw_sections.append((title, level, body))
                idx += 2
            else:
                if chunk:
                    raw_sections.append(("Overview", 1, chunk))
                idx += 1
    else:
        if content.strip():
            raw_sections.append(("Overview", 1, content.strip()))

    # Apply nonlesson heading filter
    filtered: list[tuple[str, int, str]] = []
    skipped_heading_level: int | None = None
    for title, level, body in raw_sections:
        title_clean = re.sub(r"^\d+(\.\d+)*\.?\s*", "", title).strip()
        title_normalized = re.sub(r"[:\s]+$", "", title_clean).strip().lower()
        if skipped_heading_level is not None:
            if level <= skipped_heading_level:
                skipped_heading_level = None
            else:
                continue
        if NONLESSON_HEADING_PATTERN.match(title_normalized):
            skipped_heading_level = level
            continue
        filtered.append((title, level, body))

    return filtered


def extract_sections_from_html(soup: BeautifulSoup, default_title: str) -> tuple[str, list[Section]]:
    """
    Extract structured sections from an HTML page with precedence:
    generic article/main body precedence (Wikipedia only fallback).
    """
    # Determine title
    title = ""
    if soup.title and soup.title.get_text():
        title = soup.title.get_text().strip()
    if not title:
        h1 = soup.find("h1")
        if h1 and h1.get_text():
            title = h1.get_text().strip()
    if not title:
        title = default_title or "Overview"

    # Main body container precedence
    main_node = (
        soup.find("article")
        or soup.find("main")
        or soup.find(attrs={"role": "main"})
        or soup.select_one("#mw-content-text .mw-parser-output")
        or soup.find("div", {"id": "mw-content-text"})
        or soup.body
        or soup
    )

    # 1. Preserve math before any text extraction or element deletion
    preserve_math_in_soup(main_node)

    # 2. Remove unwanted boilerplate/navigation/widgets
    for sel in REMOVE_SELECTORS:
        for tag in main_node.select(sel):
            tag.decompose()

    # 3. Replace <br> tags with newlines
    for br in main_node.find_all("br"):
        br.replace_with("\n")

    # 4. Preserve bold/italic Markdown formatting
    for tag in reversed(main_node.find_all(["strong", "b", "em", "i", "code"])):
        if tag.find_parent("pre"):
            continue
        name = tag.name.lower()
        marker = "**" if name in ("strong", "b") else ("`" if name == "code" else "*")
        inner_text = tag.get_text()
        tag.replace_with(f"{marker}{inner_text}{marker}")

    # 5. Extract blocks while avoiding nested duplicate paragraphs
    blocks_and_headings: list[tuple[str, int, str]] = []  # ('heading' | 'block', level, text)
    target_tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "pre", "blockquote", "figcaption", "table"]

    skipped_heading_level: int | None = None

    for element in main_node.find_all(target_tags):
        name = element.name.lower()
        if re.match(r"^h[1-6]$", name):
            level = int(name[1])
            if skipped_heading_level is not None and level <= skipped_heading_level:
                skipped_heading_level = None
            raw_heading = element.get_text().strip()
            heading_clean = re.sub(r"^\d+(\.\d+)*\.?\s*", "", raw_heading).strip()
            heading_normalized = re.sub(r"[:\s]+$", "", heading_clean).strip().lower()
            if NONLESSON_HEADING_PATTERN.match(heading_normalized):
                skipped_heading_level = level
                continue
            if skipped_heading_level is not None:
                continue
            blocks_and_headings.append(("heading", level, heading_clean or raw_heading))
            continue

        if skipped_heading_level is not None:
            continue

        # Avoid duplicate nested extraction
        parent_container = element.find_parent(["table", "pre", "blockquote"])
        if parent_container is not None and element != parent_container:
            continue
        if name != "li" and element.find_parent("li") is not None:
            continue

        # Filter out promo/link-only blocks
        plain = element.get_text().strip()
        has_link = element.find("a") is not None
        if has_link and PROMO_LINK_PATTERN.match(plain):
            continue

        # For list items, handle nested lists without duplicating child li text in parent li
        content_elem = element
        if name == "li":
            # Shallow copy or clone to strip sub-lists
            sub_lists = element.find_all(["ul", "ol"])
            if sub_lists:
                # Extract text excluding sub-lists
                # Clone element via BeautifulSoup
                cloned_li = BeautifulSoup(str(element), "html.parser").find("li")
                if cloned_li:
                    for sl in cloned_li.find_all(["ul", "ol"]):
                        sl.decompose()
                    content_elem = cloned_li

        text = meaningful_block_text(content_elem)
        if len(text.strip()) >= 2:
            blocks_and_headings.append(("block", 0, text.strip()))

    # Group into Section objects
    sections: list[Section] = []
    current_title = "Overview"
    current_level = 1
    current_blocks: list[str] = []

    for kind, level, text in blocks_and_headings:
        if kind == "heading":
            if current_blocks:
                body = "\n\n".join(current_blocks).strip()
                if body:
                    sections.append(
                        Section(
                            id=f"sec-{len(sections) + 1}",
                            title=current_title,
                            level=current_level,
                            content=body,
                            summary=body[:250] + "...",
                            equations=extract_equations_from_content(body),
                        )
                    )
            current_title = text
            current_level = level
            current_blocks = []
        else:
            current_blocks.append(text)

    if current_blocks:
        body = "\n\n".join(current_blocks).strip()
        if body:
            sections.append(
                Section(
                    id=f"sec-{len(sections) + 1}",
                    title=current_title,
                    level=current_level,
                    content=body,
                    summary=body[:250] + "...",
                    equations=extract_equations_from_content(body),
                )
            )

    return title, sections


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
    document_id: str | None = None,
) -> StructuredPaper:
    """
    Ingest a document from pre-parsed sections, raw markdown/text, or remote URL.
    Returns a StructuredPaper compatible with the multi-agent Manim generation pipeline.
    """
    doc_id = document_id or generate_document_id(title, url)
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
    elif url and not content and (url.lower().endswith(".pdf") or source_type == "pdf"):
        logger.info("Fetching remote PDF from %s", url)
        async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
            resp = await fetch_public_document(client, url)
            parsed_content = parse_pdf(resp.content)
            extracted = extract_sections(parsed_content)
            sections = filter_nonlesson_sections(extracted)

    # Case 3: Remote Wikipedia or Web Article
    elif url and not content:
        logger.info("Fetching web article from %s", url)
        async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
            resp = await fetch_public_document(client, url)
            soup = BeautifulSoup(resp.text, "lxml" if "lxml" in BeautifulSoup.__dict__ else "html.parser")
            extracted_title, extracted_sections = extract_sections_from_html(soup, title)
            if not title:
                title = extracted_title
            sections = extracted_sections

    # Case 4: Raw text or Markdown passed in payload
    elif content:
        logger.info("Parsing raw text content (%d chars)", len(content))
        md_sections = filter_markdown_sections(content)
        for sec_title, sec_level, sec_body in md_sections:
            if sec_body.strip():
                sections.append(
                    Section(
                        id=f"sec-{len(sections) + 1}",
                        title=sec_title,
                        level=sec_level,
                        content=sec_body.strip(),
                        summary=sec_body.strip()[:250] + "...",
                        equations=extract_equations_from_content(sec_body),
                    )
                )
        if not sections and content.strip():
            sections.append(
                Section(
                    id="sec-1",
                    title=title or "Overview",
                    level=1,
                    content=content.strip(),
                    summary=content.strip()[:250] + "...",
                    equations=extract_equations_from_content(content),
                )
            )
    sections = [section for section in sections if section.content.strip()]
    if not sections:
        raise ValueError("No readable source text was found in this document.")

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
