import { describe, expect, it } from "vitest";
import { renderLatex } from "./latex";

describe("renderLatex math delimiters", () => {
  it("renders single-character inline formulas", () => {
    const rendered = renderLatex("Let $x$ be an unknown variable.");
    expect(rendered).toContain('class="katex"');
    expect(rendered).toContain("x");
  });

  it("preserves display math and longer inline formulas", () => {
    const inline = renderLatex("We compute $f(x) = x^2$.");
    expect(inline).toContain('class="katex"');
    expect(inline).toContain("f(x)");

    const display = renderLatex("$$\\sum_{i=1}^n i$$");
    expect(display).toContain('class="katex-display"');
  });
});
