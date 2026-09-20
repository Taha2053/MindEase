// ============================================================
// layer1/layer1.test.ts - Unit tests for Layer 1 transformation & parsing
// ============================================================

import { describe, it, expect } from "vitest";
import { parseAnnotatedContent } from "./index";
import { recoverSourceText, validateSourceIntegrity } from "./sourceIntegrity";

describe("Layer 1 - Content Transformation Parser", () => {
  it("parses annotated content into structured chunks", () => {
    const raw = `
[CHUNK 1]
[CONCEPT: Gradient Descent]
Gradient descent is a first-order iterative optimization algorithm.
[DEF: Optimization]
[FORMULA]w = w - \\eta \\nabla L(w)[/FORMULA]
[EXAMPLE]
For instance, finding the lowest point in a bowl.
[/EXAMPLE]
[SUMMARY: Optimization algorithm to minimize loss]

[CHUNK 2]
[CONCEPT: Learning Rate]
The learning rate determines step size at each iteration.
`;

    const chunks = parseAnnotatedContent(raw, "https://example.com/ml", "website");

    expect(chunks.length).toBe(2);

    expect(chunks[0].conceptTags).toContain("Gradient Descent");
    expect(chunks[0].hasDefinitions).toBe(true);
    expect(chunks[0].isExample).toBe(true);
    expect(chunks[0].summary).toBe("Optimization algorithm to minimize loss");
    expect(chunks[0].position).toBe(0);

    expect(chunks[1].conceptTags).toContain("Learning Rate");
    expect(chunks[1].position).toBe(1);
  });

  it("handles inline chunk markers without dropping same-line text", () => {
    const raw = `[CHUNK 1] [CONCEPT: Backpropagation] Backpropagation computes gradients via chain rule.`;
    const chunks = parseAnnotatedContent(raw, "https://example.com/nn", "website");

    expect(chunks.length).toBe(1);
    expect(chunks[0].conceptTags).toContain("Backpropagation");
    expect(chunks[0].text).toContain("Backpropagation computes gradients via chain rule");
  });

  it("falls back gracefully when content has no structural tags", () => {
    const raw = "This is a plain paragraph without any tags.";
    const chunks = parseAnnotatedContent(raw, "https://example.com/plain", "website");

    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe(raw);
    expect(chunks[0].conceptTags).toEqual([]);
    expect(chunks[0].position).toBe(0);
  });
});

describe("Layer 1 - Source Integrity", () => {
  const source = "Entropy measures uncertainty [1]. E = mc^2 is a formula.";

  it("accepts structural annotations without changing source content", () => {
    const annotated = `[CHUNK 1]\n[CONCEPT: Entropy]\n[DEF: Entropy]Entropy measures uncertainty [1]. [FORMULA]E = mc^2[/FORMULA] is a formula.\n[SUMMARY: Introduces entropy and a formula]`;

    expect(recoverSourceText(annotated)).toBe(source);
    expect(validateSourceIntegrity(source, annotated)).toEqual({ valid: true });
  });

  it("rejects omitted source text", () => {
    const annotated = "[CHUNK 1] Entropy measures uncertainty [1].";
    expect(validateSourceIntegrity(source, annotated)).toEqual({
      valid: false,
      reason: "source-mismatch",
    });
  });

  it("rejects duplicated and rewritten source text", () => {
    expect(validateSourceIntegrity(source, `${source} ${source}`).valid).toBe(false);
    expect(validateSourceIntegrity(source, "Entropy describes uncertainty [1]. E = mc^2 is a formula.").valid).toBe(false);
  });

  it("preserves numeric citations as source content", () => {
    expect(validateSourceIntegrity(source, `[CHUNK 1] ${source}`).valid).toBe(true);
    expect(validateSourceIntegrity(source.replace(" [1]", ""), `[CHUNK 1] ${source}`).valid).toBe(false);
  });
});
