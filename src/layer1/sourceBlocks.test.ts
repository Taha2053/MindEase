import { describe, it, expect } from "vitest";
import { attachAdaptedContent, batchSourceBlocks, createSourceBlocks } from "./sourceBlocks";

describe("immutable source blocks", () => {
  const source = "Heading [1]\n\nE = mc^2.  Keep spacing.\n\n<em>Literal HTML</em>\n";
  const blocks = createSourceBlocks(source, "https://example.com/article");
  const annotations = blocks.map(block => ({ id: block.id, concepts: ["Physics"], adaptedText: block.text, isExample: false }));
  const attach = (entries: unknown) => attachAdaptedContent(blocks, JSON.stringify({ blocks: entries }), "https://example.com/article", "website");

  it("reconstructs every source character, including citations and whitespace", () => {
    expect(blocks.map(block => block.text).join("")).toBe(source);
    expect(attach(annotations).map(chunk => chunk.sourceText).join("")).toBe(source);
  });
  it("uses repeatable IDs and distinguishes identical paragraphs", () => {
    expect(createSourceBlocks(source, "https://example.com/article")).toEqual(blocks);
    const repeated = createSourceBlocks("Same\n\nSame\n\n", "source");
    expect(new Set(repeated.map(block => block.id)).size).toBe(repeated.length);
  });
  it("rejects missing, duplicated and unknown blocks, restoring source order for reordered output", () => {
    expect(() => attach(annotations.slice(1))).toThrow();
    expect(() => attach(annotations.map(() => annotations[0]))).toThrow();
    expect(attach([...annotations].reverse()).map(chunk => chunk.id)).toEqual(blocks.map(block => block.id));
    expect(() => attach(annotations.map(entry => ({ ...entry, id: "unknown" })))).toThrow();
  });
  it("rejects rewritten source fields and invalid metadata", () => {
    expect(() => attach(annotations.map(entry => ({ ...entry, text: "replacement" })))).toThrow();
    expect(() => attach(annotations.map(entry => ({ ...entry, concepts: [42] })))).toThrow();
  });
  it("splits and batches long documents without losing source characters", () => {
    const longSource = `${"A".repeat(17_000)}\n\n${"B".repeat(17_000)}`;
    const longBlocks = createSourceBlocks(longSource, "long-source");
    const batches = batchSourceBlocks(longBlocks);
    expect(longBlocks.map(block => block.text).join("")).toBe(longSource);
    expect(batches.flat()).toEqual(longBlocks);
    expect(batches.every(batch => batch.reduce((sum, block) => sum + block.text.length, 0) <= 18_000)).toBe(true);
  });
  it("anchors generated lessons to source blocks and preserves formulas", () => {
    const formulaSource = "Energy\n\nThe relation is [FORMULA]p \\propto e^{-E/kT}[/FORMULA].\n";
    const formulaBlocks = createSourceBlocks(formulaSource, "formula-source");
    const entries = formulaBlocks.map(block => ({
      id: block.id,
      adaptedText: block.text.includes("[FORMULA]")
        ? "Lower energy means greater likelihood: [FORMULA]p \\propto e^{-E/kT}[/FORMULA]."
        : "Energy",
      concepts: ["Energy"],
      isExample: false,
    }));
    const chunks = attachAdaptedContent(formulaBlocks, JSON.stringify({ blocks: entries }), "formula-source", "website");
    expect(chunks.map(chunk => chunk.sourceText).join("")).toBe(formulaSource);
    expect(chunks[1].text).toContain("[FORMULA]p \\propto e^{-E/kT}[/FORMULA]");
    entries[1].adaptedText = "The relation is p = e^-E.";
    expect(() => attachAdaptedContent(formulaBlocks, JSON.stringify({ blocks: entries }), "formula-source", "website")).toThrow(/formula/i);
  });
  it("does not split long formulas or code fences across model requests", () => {
    const formula = `$$\\begin{aligned}${"a+b &= c+d \\\\\n".repeat(600)}\\end{aligned}$$`;
    const code = "```python\n" + "print('$x$')\n".repeat(700) + "```";
    const text = "Introduction\n\n" + formula + "\n\n" + code + "\n\nConclusion";
    const result = createSourceBlocks(text, "protected");
    expect(result.map(block => block.text).join("")).toBe(text);
    expect(result.some(block => block.text.includes(formula))).toBe(true);
    expect(result.some(block => block.text.includes(code))).toBe(true);
  });

  it.each(["$x+y$", "$$x+y$$", "\\(x+y\\)", "\\[x+y\\]"])("rejects loss of source formula %s", formula => {
    const blocks = createSourceBlocks(`The relation is ${formula}.`, "formula");
    const entries = blocks.map(block => ({ id: block.id, adaptedText: "The relation is simple.", concepts: ["Relation"], isExample: false }));
    expect(() => attachAdaptedContent(blocks, JSON.stringify({ blocks: entries }), "formula", "website")).toThrow(/formula/i);
  });
});
