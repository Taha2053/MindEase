// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractReadingText } from "./sourceExtraction";

const extract = (html: string) => extractReadingText(new DOMParser().parseFromString(html, "text/html"));

describe("source extraction", () => {
  it("keeps lesson structure while skipping recommendation sections only until a peer heading", () => {
    const text = extract(`<nav>Account menu</nav><article><h1>Energy</h1><p><strong>Energy</strong> is <em>conserved</em>.</p><h2>Related articles</h2><p><a href='/promo'>Read another course</a></p><h3>Sponsored</h3><p>Buy it</p><h2>Derivation</h2><p>The useful proof.</p><h2>Notes</h2><p>Assume constant mass.</p><aside>More recommendations</aside></article>`);
    expect(text).toContain("# Energy\n\n**Energy** is *conserved*.");
    expect(text).toContain("## Derivation\n\nThe useful proof.");
    expect(text).toContain("## Notes\n\nAssume constant mass.");
    expect(text).not.toMatch(/Account menu|Read another course|Buy it|recommendations/);
  });

  it("preserves renderer TeX once before removing accessibility duplicates", () => {
    const text = extract(`<main><p>Energy: <span class='katex'><span aria-hidden='true'>E visual duplicate</span><math><semantics><mi>E</mi><annotation encoding='application/x-tex'>E = mc^2</annotation></semantics></math></span>.</p><p>Ratio: <math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>.</p></main>`);
    expect(text.match(/E = mc\^2/g)).toHaveLength(1);
    expect(text).toContain("[FORMULA]E = mc^2[/FORMULA]");
    expect(text).toContain("[FORMULA]\\frac{a}{b}[/FORMULA]");
    expect(text).not.toContain("visual duplicate");
  });

  it("keeps standalone equations and unwrapped article text", () => {
    const text = extract(`<article>Introductory text.<div class='equation'><math alttext='F = ma'><mi>F</mi></math></div><p>A measured force.</p></article>`);
    expect(text).toContain("Introductory text.");
    expect(text).toContain("[FORMULA]F = ma[/FORMULA]");
    expect(text).toContain("A measured force.");
  });

  it("retains code, nested list items, and tables without repeating cell or child text", () => {
    const text = extract(`<article><ul><li>Parent<ul><li>Child</li></ul></li></ul><pre><code>if x &lt; 3:\n    print(x)</code></pre><table><tr><th>Quantity</th><th>Unit</th></tr><tr><td><p>Force</p></td><td>N</td></tr></table></article>`);
    expect(text.match(/Child/g)).toHaveLength(1);
    expect(text.match(/Force/g)).toHaveLength(1);
    expect(text).toContain("```\nif x < 3:\n    print(x)\n```");
    expect(text).toContain("| Quantity | Unit |\n| --- | --- |\n| Force | N |");
  });
});
