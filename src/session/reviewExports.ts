import { marked } from "marked";
import DOMPurify from "dompurify";
import type { SessionFolderSummary, StudyCard } from "@/types";

/**
 * Escapes HTML characters in text.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validates that a string is a safe http or https URL.
 */
export function isValidHttpUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Export HTML uses the same browser sanitizer as the reading surface. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "input", "form", "img"],
  });
}

/**
 * Renders card content to sanitized HTML with Anki MathJax-compatible delimiters
 * (\( ... \) for inline and \[ ... \] for display formulas), appends the source
 * if present, and replaces all tabs and newlines with spaces.
 */
export function renderAnkiCardAnswer(content: string, sourceId?: string): string {
  const math: string[] = [];

  // Match code blocks/inlines first to protect them, then math formulas
  const textWithPlaceholders = (content || "").replace(
    /```[\s\S]*?```|`[^`\n]+`|\[FORMULA\]([\s\S]*?)\[\/FORMULA\]|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/g,
    (match, tagged, dollars, brackets, inline, single) => {
      if (match.startsWith("`")) return match;
      const formula = tagged ?? dollars ?? brackets ?? inline ?? single;
      if (formula === undefined) return match;

      const isDisplay = tagged !== undefined || dollars !== undefined || brackets !== undefined;
      const token = `MINDEASEMATHANKI${math.length}TOKEN`;
      const trimmed = formula.trim();
      const delimiter = isDisplay ? `\\[${trimmed}\\]` : `\\(${trimmed}\\)`;
      math.push(escapeHtml(delimiter));
      return token;
    }
  );

  const rawHtml = marked.parse(textWithPlaceholders, { async: false, gfm: true }) as string;
  const sanitized = sanitizeHtml(rawHtml);
  const withMath = sanitized.replace(
    /MINDEASEMATHANKI(\d+)TOKEN/g,
    (_, idx) => math[Number(idx)] ?? ""
  );

  let sourceHtml = "";
  if (sourceId && sourceId.trim()) {
    const trimmed = sourceId.trim();
    if (isValidHttpUrl(trimmed)) {
      const safe = escapeHtml(trimmed);
      sourceHtml = `<div class="card-source">Source: <a href="${safe}">${safe}</a></div>`;
    } else {
      sourceHtml = `<div class="card-source">Source: ${escapeHtml(trimmed)}</div>`;
    }
  }

  const combined = sourceHtml
    ? withMath.trim()
      ? `${withMath} ${sourceHtml}`
      : sourceHtml
    : withMath;

  // Replace tabs and newlines with spaces for TSV row integrity
  return combined.replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * Exports cards to Anki TSV format with:
 * #separator:tab
 * #html:true
 * Question: HTML-escaped concept with tabs/newlines replaced by spaces
 * Answer: Markdown rendered, sanitized, MathJax delimited math, source appended, tabs/newlines replaced by spaces
 */
export function exportAnkiTsv(
  input: StudyCard[] | SessionFolderSummary
): string {
  const cards: StudyCard[] = Array.isArray(input)
    ? input
    : Array.isArray(input.studyCards)
    ? input.studyCards
    : [];

  const lines: string[] = ["#separator:tab", "#html:true"];

  for (const card of cards) {
    const conceptText = card.concept || "";
    const cleanQuestion = escapeHtml(conceptText).replace(/[\t\r\n]+/g, " ").trim();
    const cleanAnswer = renderAnkiCardAnswer(card.content || "", card.sourceId);
    lines.push(`${cleanQuestion}\t${cleanAnswer}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Exports session folder to Markdown summary with overview, resources, actual saved chunks, and cards.
 */
export function exportMarkdownSummary(folder: SessionFolderSummary): string {
  const parts: string[] = [];

  const title = folder.title?.trim() || folder.folderName || "Lesson Summary";
  parts.push(`# ${title}`);

  const metaLines: string[] = [];
  if (folder.savedAt || folder.dateStr) {
    const dateFormatted = folder.savedAt
      ? new Date(folder.savedAt).toLocaleDateString(undefined, { dateStyle: "medium" })
      : folder.dateStr;
    metaLines.push(`- **Date:** ${dateFormatted}`);
  }
  if (folder.durationMs) {
    metaLines.push(`- **Duration:** ${Math.round(folder.durationMs / 60000)} minutes`);
  }
  if (folder.conceptCount) {
    metaLines.push(`- **Concepts Covered:** ${folder.conceptCount}`);
  }
  if (metaLines.length > 0) {
    parts.push(metaLines.join("\n"));
  }

  if (folder.history?.summaryText?.trim()) {
    parts.push(`## Overview\n\n${folder.history.summaryText.trim()}`);
  }

  if (Array.isArray(folder.resources) && folder.resources.length > 0) {
    const resourceLines: string[] = [];
    for (const res of folder.resources) {
      const resTitle = res.title?.trim() || res.url?.trim() || "Resource";
      const validUrl = isValidHttpUrl(res.url) ? res.url.trim() : null;
      const typeNote = res.sourceType ? ` (${res.sourceType})` : "";
      if (validUrl) {
        resourceLines.push(`- [${resTitle}](${validUrl})${typeNote}`);
      } else {
        resourceLines.push(`- ${resTitle}${typeNote}`);
      }
    }
    if (resourceLines.length > 0) {
      parts.push(`## Resources\n\n${resourceLines.join("\n")}`);
    }
  }

  if (Array.isArray(folder.content) && folder.content.length > 0) {
    const chunkBlocks: string[] = [];
    for (let i = 0; i < folder.content.length; i++) {
      const chunk = folder.content[i];
      const chunkTitle =
        chunk.conceptTags && chunk.conceptTags.length > 0
          ? `Chunk ${i + 1}: ${chunk.conceptTags.join(", ")}`
          : `Chunk ${i + 1}`;
      const chunkLines: string[] = [`### ${chunkTitle}`];

      if (chunk.text?.trim()) {
        chunkLines.push(chunk.text.trim());
      }
      if (chunk.sourceText && chunk.sourceText.trim() !== chunk.text?.trim()) {
        chunkLines.push(
          `> **Original Source:**\n> ${chunk.sourceText.trim().replace(/\n/g, "\n> ")}`
        );
      }
      if (chunk.sourceId?.trim()) {
        const trimmedSrc = chunk.sourceId.trim();
        const validSrc = isValidHttpUrl(trimmedSrc)
          ? `[${trimmedSrc}](${trimmedSrc})`
          : trimmedSrc;
        chunkLines.push(`*Source: ${validSrc}*`);
      }

      chunkBlocks.push(chunkLines.join("\n\n"));
    }
    parts.push(`## Saved Chunks\n\n${chunkBlocks.join("\n\n")}`);
  }

  if (Array.isArray(folder.studyCards) && folder.studyCards.length > 0) {
    const cardBlocks: string[] = [];
    for (const card of folder.studyCards) {
      const cardTitle = card.concept?.trim() || "Concept";
      const flagNote = card.reviewFlag ? " *(Needs Review)*" : "";
      const cardLines: string[] = [`### ${cardTitle}${flagNote}`];

      if (card.content?.trim()) {
        cardLines.push(card.content.trim());
      }
      if (card.sourceId?.trim()) {
        const trimmedSrc = card.sourceId.trim();
        const validSrc = isValidHttpUrl(trimmedSrc)
          ? `[${trimmedSrc}](${trimmedSrc})`
          : trimmedSrc;
        cardLines.push(`*Source: ${validSrc}*`);
      }

      cardBlocks.push(cardLines.join("\n\n"));
    }
    parts.push(`## Review Cards\n\n${cardBlocks.join("\n\n")}`);
  }

  return parts.join("\n\n") + "\n";
}

/**
 * Downloads text content as a file via browser object URL.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Triggers download of Anki TSV deck for a session folder.
 */
export function downloadAnkiExport(folder: SessionFolderSummary): void {
  const tsv = exportAnkiTsv(folder);
  const safeName = (folder.folderName || folder.sessionId || "session").replace(/[^\w.-]/g, "_");
  downloadFile(tsv, `${safeName}_anki.tsv`, "text/tab-separated-values;charset=utf-8");
}

/**
 * Triggers download of Markdown summary for a session folder.
 */
export function downloadMarkdownExport(folder: SessionFolderSummary): void {
  const md = exportMarkdownSummary(folder);
  const safeName = (folder.folderName || folder.sessionId || "session").replace(/[^\w.-]/g, "_");
  downloadFile(md, `${safeName}_summary.md`, "text/markdown;charset=utf-8");
}
