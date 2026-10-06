"""Behavioral tests for MindEase document ingestion corrections.

Covers:
- Generic article/main body precedence over Wikipedia fallback.
- Removal of nav, footer, aside, script, style, form, and related/recommended article widgets.
- Math retention from MathML alttext, annotation application/x-tex, KaTeX, and MathJax as [FORMULA]TeX[/FORMULA] exactly once.
- Retention of bold/italic Markdown, bulleted lists, preformatted code, and tables without duplicate nested paragraphs.
- Exclusion of promo/link-only blocks ("Read more", "See also", "Check out") while keeping ordinary in-prose links.
- Skipping nonlesson sections (References, Bibliography, See also, Related) until the next same or higher heading.
- Application of nonlesson heading filtering across HTML, PDF sections, and raw Markdown sections without stripping normal 'Notes' teaching sections or prose containing 'see'.
- Full content preservation without programmatic shortening.
"""

import pytest
from bs4 import BeautifulSoup
import httpx

from ingestion.document_ingest import (
    extract_sections_from_html,
    filter_markdown_sections,
    filter_nonlesson_sections,
    ingest_document,
    preserve_math_in_soup,
)
from models.paper import Section


class TestMathRetention:
    def test_mathml_alttext_preserved_as_formula_once(self):
        html = """
        <article>
            <h1>Quantum States</h1>
            <p>The state is represented by <math alttext="\\psi = \\alpha |0\\rangle + \\beta |1\\rangle"><mi>ψ</mi></math> in Hilbert space.</p>
        </article>
        """
        soup = BeautifulSoup(html, "html.parser")
        title, sections = extract_sections_from_html(soup, "Default Title")
        assert title == "Quantum States"
        assert len(sections) == 1
        content = sections[0].content
        assert "[FORMULA]\\psi = \\alpha |0\\rangle + \\beta |1\\rangle[/FORMULA]" in content
        # Ensure it appears exactly once
        assert content.count("[FORMULA]") == 1
        assert content.count("[/FORMULA]") == 1

    def test_mathml_annotation_application_x_tex_preserved_once(self):
        html = """
        <article>
            <p>Calculated as <math><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math> uniformly.</p>
        </article>
        """
        soup = BeautifulSoup(html, "html.parser")
        _, sections = extract_sections_from_html(soup, "Energy")
        content = sections[0].content
        assert "[FORMULA]E = mc^2[/FORMULA]" in content
        assert content.count("[FORMULA]") == 1

    def test_katex_outer_wrapper_preserved_without_duplicate(self):
        html = """
        <main>
            <p>The loss function:
                <span class="katex-display">
                    <span class="katex">
                        <span class="katex-mathml">
                            <math alttext="L(\\theta) = -\\sum y \\log(\\hat{y})">
                                <annotation encoding="application/x-tex">L(\\theta) = -\\sum y \\log(\\hat{y})</annotation>
                            </math>
                        </span>
                        <span class="katex-html" aria-hidden="true">
                            <span class="base"><span>L</span></span>
                        </span>
                    </span>
                </span>
            </p>
        </main>
        """
        soup = BeautifulSoup(html, "html.parser")
        _, sections = extract_sections_from_html(soup, "Loss")
        content = sections[0].content
        assert "[FORMULA]L(\\theta) = -\\sum y \\log(\\hat{y})[/FORMULA]" in content
        assert content.count("[FORMULA]") == 1
        assert "katex-html" not in content

    def test_mathjax_outer_wrapper_preserved_once(self):
        html = """
        <article>
            <p>Newton's law:
                <mjx-container data-tex="F = ma">
                    <svg><text>F = ma</text></svg>
                </mjx-container>
            </p>
        </article>
        """
        soup = BeautifulSoup(html, "html.parser")
        _, sections = extract_sections_from_html(soup, "Newton")
        content = sections[0].content
        assert "[FORMULA]F = ma[/FORMULA]" in content
        assert content.count("[FORMULA]") == 1


class TestBoilerplateAndFormatting:
    def test_generic_article_precedence_over_wikipedia_container(self):
        # When page has both <article> and <div id="mw-content-text">, generic article takes precedence
        html = """
        <html>
            <body>
                <div id="mw-content-text">
                    <p>Wikipedia fallback text that should be bypassed.</p>
                </div>
                <article>
                    <h1>Real Article</h1>
                    <p>Actual article content to extract.</p>
                </article>
            </body>
        </html>
        """
        soup = BeautifulSoup(html, "html.parser")
        title, sections = extract_sections_from_html(soup, "Title")
        assert title == "Real Article"
        assert len(sections) == 1
        assert "Actual article content to extract." in sections[0].content
        assert "Wikipedia fallback" not in sections[0].content

    def test_strip_nav_footer_aside_script_style_forms_and_widgets(self):
        html = """
        <article>
            <nav><a href="/home">Home</a></nav>
            <header><h1>Header Navigation</h1></header>
            <form><input type="text"><button>Submit</button></form>
            <script>console.log("bad");</script>
            <style>.bad { color: red; }</style>
            <aside>Sidebar advertisement</aside>
            <p>Core instructional text.</p>
            <div class="related-articles">
                <h3>Related Articles</h3>
                <p>Read about other topics here.</p>
            </div>
            <div aria-label="Recommended articles">
                <p>Recommended reading widget</p>
            </div>
            <footer>Footer copyright and disclosures</footer>
        </article>
        """
        soup = BeautifulSoup(html, "html.parser")
        _, sections = extract_sections_from_html(soup, "Lesson")
        combined = " ".join(s.content for s in sections)
        assert "Core instructional text." in combined
        assert "Home" not in combined
        assert "Sidebar advertisement" not in combined
        assert "Submit" not in combined
        assert "console.log" not in combined
        assert "Related Articles" not in combined
        assert "Recommended reading widget" not in combined
        assert "Footer copyright" not in combined

    def test_markdown_formatting_preserved_without_duplicate_nesting(self):
        html = """
        <article>
            <p>Here is <strong>bold emphasis</strong> and <em>italic term</em> and <code>inline code</code>.</p>
            <pre><code>def compute(x):\n    return x * 2</code></pre>
            <ul>
                <li>First concept</li>
                <li>Second concept</li>
            </ul>
            <table>
                <tr><th>Symbol</th><th>Meaning</th></tr>
                <tr><td>x</td><td>Input vector</td></tr>
            </table>
        </article>
        """
        soup = BeautifulSoup(html, "html.parser")
        _, sections = extract_sections_from_html(soup, "Formatting")
        content = sections[0].content
        assert "**bold emphasis**" in content
        assert "*italic term*" in content
        assert "`inline code`" in content
        assert "```\ndef compute(x):\n    return x * 2\n```" in content
        assert "- First concept" in content
        assert "- Second concept" in content
        assert "| Symbol | Meaning |" in content
        assert "| x | Input vector |" in content
        # Ensure table cells were not extracted as separate orphaned paragraphs
        assert content.count("Input vector") == 1


class TestPromoLinkExclusion:
    def test_promo_link_blocks_excluded_while_prose_links_kept(self):
        html = """
        <article>
            <p>Learn more about photosynthesis by visiting the <a href="/chloroplast">chloroplast overview</a> in cell biology.</p>
            <p><a href="/next">Read more: The complete Calvin cycle breakdown</a></p>
            <p><a href="/related">Related articles: Plant cellular respiration</a></p>
            <p><a href="/check">Check out our guide to light reactions</a></p>
            <p><a href="/see">See also: ATP synthase dynamics</a></p>
            <p>Normal teaching paragraph mentioning you can see the result under microscope.</p>
        </article>
        """
        soup = BeautifulSoup(html, "html.parser")
        _, sections = extract_sections_from_html(soup, "Biology")
        content = sections[0].content
        assert "Learn more about photosynthesis by visiting the chloroplast overview" in content
        assert "Normal teaching paragraph mentioning you can see the result under microscope." in content
        assert "Read more: The complete Calvin cycle breakdown" not in content
        assert "Related articles: Plant cellular respiration" not in content
        assert "Check out our guide to light reactions" not in content
        assert "See also: ATP synthase dynamics" not in content


class TestNonlessonHeadingFilter:
    def test_html_skips_references_until_next_same_or_higher_heading(self):
        html = """
        <article>
            <h2>1 Introduction</h2>
            <p>Welcome to neural networks.</p>
            <h3>1.1 Fundamentals</h3>
            <p>Neurons and weights.</p>
            <h3>References</h3>
            <p>Smith et al., 2020.</p>
            <p>Johnson et al., 2021.</p>
            <h3>Notes</h3>
            <p>Notice that weights must be initialized properly.</p>
            <h2>2 Architecture</h2>
            <p>Deep multi-layer feedforward structure.</p>
            <h2>Bibliography</h2>
            <p>Doe, 2019.</p>
        </article>
        """
        soup = BeautifulSoup(html, "html.parser")
        _, sections = extract_sections_from_html(soup, "Neural Networks")
        titles = [s.title for s in sections]
        contents = [s.content for s in sections]
        assert "Introduction" in titles
        assert "Fundamentals" in titles
        assert "References" not in titles
        assert "Smith et al." not in " ".join(contents)
        # Notice that 'Notes' was at h3 (same level as References h3), so it resumed extraction!
        assert "Notes" in titles
        assert "initialized properly" in " ".join(contents)
        assert "Architecture" in titles
        assert "Bibliography" not in titles
        assert "Doe, 2019" not in " ".join(contents)

    def test_markdown_skips_nonlesson_until_next_same_or_higher_heading(self):
        md = """# Introduction
Overview of relativity.

## See Also
* [Newtonian physics](https://example.com)
* [Ether theory](https://example.com)

## Spacetime Curvature
Einstein field equations explain gravity as curvature.

### Notes
A key takeaway is that spacetime is dynamical.

### References
1. Einstein 1915.
2. Hilbert 1915.

# Conclusion
General relativity passed all empirical tests.
"""
        sections = filter_markdown_sections(md)
        titles = [title for title, _, _ in sections]
        assert "Introduction" in titles
        assert "See Also" not in titles
        assert "Spacetime Curvature" in titles
        assert "Notes" in titles
        assert "References" not in titles
        assert "Conclusion" in titles

    def test_filter_nonlesson_sections_on_extracted_pdf_sections(self):
        input_sections = [
            Section(id="s1", title="Abstract", level=1, content="This paper explores lasers."),
            Section(id="s2", title="1. Introduction", level=2, content="Lasers emit coherent light."),
            Section(id="s3", title="2. Related Work", level=2, content="Previous work by Maiman."),
            Section(id="s4", title="2.1 Optical Cavities", level=3, content="Cavity design details."),
            Section(id="s5", title="3. Methodology", level=2, content="We construct a diode laser."),
            Section(id="s6", title="References", level=2, content="[1] Maiman, T. H. (1960)."),
            Section(id="s7", title="Appendix A", level=3, content="Derivation of pump rate."),
            Section(id="s8", title="4. Notes on Laser Safety", level=2, content="Eye protection is mandatory."),
        ]
        filtered = filter_nonlesson_sections(input_sections)
        titles = [s.title for s in filtered]
        assert "Abstract" in titles
        assert "1. Introduction" in titles
        # Scientific related work is teaching content, not a recommendation widget.
        assert "2. Related Work" in titles
        assert "2.1 Optical Cavities" in titles
        assert "3. Methodology" in titles
        assert "References" not in titles
        assert "Appendix A" not in titles
        # Section 4 resumes because level 2 <= level 2 of References
        assert "4. Notes on Laser Safety" in titles


class TestEndToEndIngestion:
    @pytest.mark.asyncio
    async def test_raw_content_preserves_equations_without_truncation(self):
        long_formula_text = (
            "## Mathematical Derivation\n\n"
            "We derive the wave equation: [FORMULA]\\nabla^2 \\psi - \\frac{1}{c^2} \\frac{\\partial^2 \\psi}{\\partial t^2} = 0[/FORMULA].\n\n"
            + ("Detailed explanation of step-by-step physical principles. " * 30)
        )
        paper = await ingest_document(
            title="Wave Dynamics",
            source_type="website",
            content=long_formula_text,
        )
        assert len(paper.sections) == 1
        sec = paper.sections[0]
        assert "[FORMULA]\\nabla^2 \\psi" in sec.content
        assert len(sec.equations) >= 1
        assert "\\nabla^2 \\psi" in sec.equations[0].latex
        # Verify content was not programmatically shortened
        assert len(sec.content) >= len(long_formula_text.strip()) - 50
