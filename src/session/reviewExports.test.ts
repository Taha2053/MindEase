// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  isValidHttpUrl,
  renderAnkiCardAnswer,
  exportAnkiTsv,
  exportMarkdownSummary,
} from "./reviewExports";
import type { SessionFolderSummary, StudyCard } from "@/types";

describe("reviewExports URL validation & HTML escaping", () => {
  it("escapes special HTML characters properly", () => {
    expect(escapeHtml(`Special <chars> & "quotes" 'test'`)).toBe(
      "Special &lt;chars&gt; &amp; &quot;quotes&quot; &#39;test&#39;"
    );
  });

  it("validates http and https URLs while rejecting unsafe schemes", () => {
    expect(isValidHttpUrl("https://en.wikipedia.org/wiki/Photosynthesis")).toBe(true);
    expect(isValidHttpUrl("http://localhost:3000/lesson")).toBe(true);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isValidHttpUrl("data:text/html,test")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl(undefined)).toBe(false);
  });
});

describe("renderAnkiCardAnswer math & whitespace handling", () => {
  it("converts inline and display math to Anki MathJax-compatible delimiters", () => {
    const raw = "Inline $x + y = z$ and display $$\\int_0^1 f(t) dt$$ and bracket \\[E = mc^2\\] and paren \\(a = b\\).";
    const rendered = renderAnkiCardAnswer(raw);

    expect(rendered).toContain("\\(x + y = z\\)");
    expect(rendered).toContain("\\[\\int_0^1 f(t) dt\\]");
    expect(rendered).toContain("\\[E = mc^2\\]");
    expect(rendered).toContain("\\(a = b\\)");
    // Should not contain raw KaTeX DOM elements
    expect(rendered).not.toContain("katex-html");
    expect(rendered).not.toContain("katex-display");
  });

  it("converts [FORMULA] tags to MathJax display delimiters", () => {
    const raw = "Energy: [FORMULA]E = mc^2[/FORMULA]";
    const rendered = renderAnkiCardAnswer(raw);
    expect(rendered).toContain("\\[E = mc^2\\]");
  });

  it("preserves formulas inside inline and fenced code blocks verbatim", () => {
    const raw = "Code span `$x$` and fenced block:\n```\n$$x^2$$\n```";
    const rendered = renderAnkiCardAnswer(raw);
    expect(rendered).toContain("<code>$x$</code>");
    expect(rendered).toContain("$$x^2$$");
  });

  it("replaces all tabs, newlines, and carriage returns with spaces for TSV integrity", () => {
    const raw = "Line 1\n\tLine 2\r\n\t\tLine 3 with   spacing.";
    const rendered = renderAnkiCardAnswer(raw);

    expect(rendered).not.toContain("\n");
    expect(rendered).not.toContain("\r");
    expect(rendered).not.toContain("\t");
  });

  it("appends valid source URLs as hyperlinks and invalid ones as text", () => {
    const withUrl = renderAnkiCardAnswer("Test content", "https://example.com/source");
    expect(withUrl).toContain('<a href="https://example.com/source">https://example.com/source</a>');

    const withText = renderAnkiCardAnswer("Test content", "Lecture 5 Notes");
    expect(withText).toContain("Source: Lecture 5 Notes");
    expect(withText).not.toContain("<a href=");

    const withoutSource = renderAnkiCardAnswer("Test content");
    expect(withoutSource).not.toContain("Source:");
  });

  it("sanitizes unsafe HTML script tags", () => {
    const raw = "Content with <script>alert('xss')</script> and normal text.";
    const rendered = renderAnkiCardAnswer(raw);
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("alert('xss')");
  });

  it("rejects executable HTML even when hidden inside a formula", () => {
    const rendered = renderAnkiCardAnswer('$x <img src=x onerror="alert(1)">$ <a href="javascript:alert(1)">bad link</a>');
    const container = document.createElement("div");
    container.innerHTML = rendered;
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(container.textContent).toContain('x <img src=x onerror="alert(1)">');
  });
});

describe("exportAnkiTsv format & structure", () => {
  it("includes required Anki TSV headers", () => {
    const tsv = exportAnkiTsv([]);
    const lines = tsv.trim().split("\n");
    expect(lines[0]).toBe("#separator:tab");
    expect(lines[1]).toBe("#html:true");
  });

  it("formats question with HTML escaping and replaces tabs/newlines", () => {
    const card: StudyCard = {
      id: "card-1",
      concept: "Photosynthesis <Type 1>\n\tSub-concept",
      format: "chunked-text",
      content: "Process of plants converting light.\n\tFormula: $$6CO_2 + 6H_2O$$",
      sourceId: "https://example.org/bio",
      reviewFlag: false,
    };

    const tsv = exportAnkiTsv([card]);
    const lines = tsv.trim().split("\n");
    expect(lines).toHaveLength(3); // 2 header lines + 1 card row

    const [question, answer] = lines[2].split("\t");
    expect(question).toBe("Photosynthesis &lt;Type 1&gt; Sub-concept");
    expect(question).not.toContain("\n");
    expect(question).not.toContain("\t");

    expect(answer).toContain("\\[6CO_2 + 6H_2O\\]");
    expect(answer).toContain("https://example.org/bio");
    expect(answer).not.toContain("\n");
    expect(answer).not.toContain("\r");
  });

  it("accepts a SessionFolderSummary object directly", () => {
    const folder: Partial<SessionFolderSummary> = {
      sessionId: "sess-1",
      studyCards: [
        {
          id: "c1",
          concept: "Mitosis",
          format: "chunked-text",
          content: "Cell division phase.",
          sourceId: "https://bio.example",
          reviewFlag: true,
        },
      ],
    };

    const tsv = exportAnkiTsv(folder as SessionFolderSummary);
    expect(tsv).toContain("Mitosis\t");
    expect(tsv).toContain("Cell division phase.");
  });
});

describe("exportMarkdownSummary content fidelity", () => {
  it("exports complete summary with chunks, sources, and cards without inventing facts", () => {
    const folder: SessionFolderSummary = {
      sessionId: "session-101",
      sessionNumber: 1,
      dateStr: "2026-10-05",
      folderName: "2026-10-05_Session-01",
      title: "Cellular Biology & Genetics",
      durationMs: 1200000,
      conceptCount: 2,
      focusScore: 92,
      destination: "local",
      savedAt: 1774000000000,
      videos: [],
      visuals: [],
      history: {
        topic: "Biology",
        concepts: ["DNA", "RNA"],
        timeSpentMinutes: 20,
        notesCount: 5,
        summaryText: "Comprehensive overview of genetic transcription.",
      },
      resources: [
        {
          url: "https://example.org/genetics",
          title: "Genetics Primer",
          sourceType: "website",
          timeSpentMs: 600000,
          notesCount: 2,
          conceptsFound: ["DNA"],
          joinedAt: 1000,
          lastActiveAt: 2000,
        },
      ],
      content: [
        {
          id: "chk-1",
          position: 0,
          sourceId: "https://example.org/genetics",
          sourceType: "website",
          text: "Adapted explanation of DNA transcription.",
          sourceText: "Original raw text from textbook.",
          conceptTags: ["DNA", "Transcription"],
        },
      ],
      studyCards: [
        {
          id: "card-1",
          concept: "Transcription",
          format: "chunked-text",
          content: "RNA polymerase synthesizes RNA from DNA template.",
          sourceId: "https://example.org/genetics",
          reviewFlag: true,
        },
      ],
    };

    const md = exportMarkdownSummary(folder);

    expect(md).toContain("# Cellular Biology & Genetics");
    expect(md).toContain("Comprehensive overview of genetic transcription.");
    expect(md).toContain("[Genetics Primer](https://example.org/genetics)");
    expect(md).toContain("Adapted explanation of DNA transcription.");
    expect(md).toContain("Original raw text from textbook.");
    expect(md).toContain("### Transcription *(Needs Review)*");
    expect(md).toContain("RNA polymerase synthesizes RNA from DNA template.");
  });

  it("handles older archives with empty or omitted studyCards and content", () => {
    const folder: SessionFolderSummary = {
      sessionId: "session-old",
      sessionNumber: 1,
      dateStr: "2026-09-01",
      folderName: "2026-09-01_Session-01",
      title: "Older Session",
      durationMs: 600000,
      conceptCount: 0,
      focusScore: 80,
      destination: "local",
      savedAt: 1770000000000,
      videos: [],
      visuals: [],
      history: {
        topic: "Legacy",
        concepts: [],
        timeSpentMinutes: 10,
        notesCount: 0,
        summaryText: "Old session summary.",
      },
    };

    const md = exportMarkdownSummary(folder);
    expect(md).toContain("# Older Session");
    expect(md).not.toContain("## Saved Chunks");
    expect(md).not.toContain("## Review Cards");
    expect(md).not.toContain("## Resources");
  });
});
