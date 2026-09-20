import { describe, it, expect } from "vitest";
import { attachAnnotations, createSourceBlocks } from "./sourceBlocks";

describe("immutable source blocks", () => {
  const source = "Heading [1]\n\nE = mc^2.  Keep spacing.\n\n<em>Literal HTML</em>\n";
  const blocks = createSourceBlocks(source, "https://example.com/article");
  const annotations = blocks.map(block => ({ id: block.id, concepts: ["Physics"], summary: "Generated explanation", isExample: false }));
  const attach = (entries: unknown) => attachAnnotations(blocks, JSON.stringify({ blocks: entries }), "https://example.com/article", "website");

  it("reconstructs every source character, including citations and whitespace", () => {
    expect(blocks.map(block => block.text).join("")).toBe(source);
    expect(attach(annotations).map(chunk => chunk.sourceText).join("")).toBe(source);
  });
  it("uses repeatable IDs and distinguishes identical paragraphs", () => {
    expect(createSourceBlocks(source, "https://example.com/article")).toEqual(blocks);
    const repeated = createSourceBlocks("Same\n\nSame\n\n", "source");
    expect(new Set(repeated.map(block => block.id)).size).toBe(repeated.length);
  });
  it("rejects omitted, duplicated, reordered and unknown block references", () => {
    expect(() => attach(annotations.slice(1))).toThrow();
    expect(() => attach(annotations.map(() => annotations[0]))).toThrow();
    expect(() => attach([...annotations].reverse())).toThrow();
    expect(() => attach(annotations.map(entry => ({ ...entry, id: "unknown" })))).toThrow();
  });
  it("rejects rewritten source fields and invalid metadata", () => {
    expect(() => attach(annotations.map(entry => ({ ...entry, text: "replacement" })))).toThrow();
    expect(() => attach(annotations.map(entry => ({ ...entry, concepts: [42] })))).toThrow();
  });
});
