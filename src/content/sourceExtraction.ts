const REMOVE_SELECTORS = [
  "script", "style", "noscript", "nav", "footer", "aside", "form",
  "[hidden]", "[aria-hidden='true']", "[id^='mindease-']",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']",
  ".mw-editsection", ".mw-jump-link", ".noprint", ".navbox", ".vertical-navbox",
  ".sidebar", ".metadata", ".ambox", ".hatnote", ".shortdescription",
  ".mw-authority-control", ".catlinks", ".printfooter", ".sistersitebox",
  ".vector-page-toolbar", ".vector-dropdown", ".uls-language-list",
  ".reflist", ".references", ".refbegin", ".portal", ".citation",
  ".related-articles", ".related-posts", ".recommended-articles", "[data-related-content]",
  "[aria-label='Related articles']", "[aria-label='Recommended articles']",
  "button", "select", "input", "textarea",
].join(",");

const normalizeBlockText = (value: string): string => value
  .replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function mathToTex(element: Element): string {
  const parts = [...element.children].map(mathToTex);
  switch (element.localName) {
    case "annotation": case "annotation-xml": return "";
    case "mfrac": return `\\frac{${parts[0] ?? ""}}{${parts[1] ?? ""}}`;
    case "msup": return `{${parts[0] ?? ""}}^{${parts[1] ?? ""}}`;
    case "msub": return `{${parts[0] ?? ""}}_{${parts[1] ?? ""}}`;
    case "msubsup": return `{${parts[0] ?? ""}}_{${parts[1] ?? ""}}^{${parts[2] ?? ""}}`;
    case "msqrt": return `\\sqrt{${parts.join(" ")}}`;
    case "mroot": return `\\sqrt[${parts[1] ?? ""}]{${parts[0] ?? ""}}`;
    default: return parts.length ? parts.join(" ") : element.textContent ?? "";
  }
}

function preserveMath(root: HTMLElement, doc: Document): void {
  // Replace the outer renderer, not its duplicated visual/accessibility trees.
  root.querySelectorAll(".mwe-math-element, .katex-display, .katex, mjx-container, math, [data-tex], img.mwe-math-fallback-image")
    .forEach(element => {
      if (!root.contains(element)) return;
      const math = element.matches("math") ? element : element.querySelector("math");
      const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
      const fallback = element.matches("img") ? element : element.querySelector("img.mwe-math-fallback-image");
      const tex = element.getAttribute("data-tex") ?? annotation?.textContent ?? math?.getAttribute("alttext")
        ?? fallback?.getAttribute("alt") ?? (math ? mathToTex(math) : "");
      if (tex.trim()) element.replaceWith(doc.createTextNode(` [FORMULA]${tex.trim()}[/FORMULA] `));
    });
}

const meaningfulText = (element: Element): string => {
  const text = normalizeBlockText(element.textContent ?? "");
  if (/^H[1-6]$/.test(element.tagName)) return "#".repeat(Number(element.tagName[1])) + " " + text;
  if (element.matches("li")) return "- " + text;
  if (element.matches("pre")) return "```\n" + (element.textContent ?? "").trim() + "\n```";
  if (element.matches("table")) {
    const rows = [...element.querySelectorAll("tr")].map(row => [...row.querySelectorAll("th, td")].map(cell => normalizeBlockText(cell.textContent ?? "").replace(/\|/g, "\\|")));
    if (!rows.length) return "";
    return [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map(row => "| " + row.join(" | ") + " |").join("\n");
  }
  return text;
};

/** Semantic lesson body, retaining math and typography without recommendation widgets. */
export function extractReadingText(doc: Document = document): string {
  const root = doc.querySelector("article") ?? doc.querySelector("#mw-content-text .mw-parser-output")
    ?? doc.querySelector("main, [role='main']") ?? doc.body;
  if (!root) return "";
  const clone = root.cloneNode(true) as HTMLElement;
  // Preserve accessible TeX before removing hidden renderer duplicates.
  preserveMath(clone, doc);
  clone.querySelectorAll(REMOVE_SELECTORS).forEach(element => element.remove());
  clone.querySelectorAll("br").forEach(element => element.replaceWith(doc.createTextNode("\n")));
  [...clone.querySelectorAll("strong, b, em, i, code")].reverse().forEach(element => {
    if (element.closest("pre")) return;
    const marker = element.matches("strong, b") ? "**" : element.matches("code") ? "`" : "*";
    element.replaceWith(doc.createTextNode(marker + (element.textContent ?? "") + marker));
  });
  const semanticBlocks = "h1, h2, h3, h4, h5, h6, p, li, dt, dd, pre, blockquote, figcaption, table";
  const elements: Element[] = [];
  const collect = (container: Element): void => {
    let inline = "";
    const flush = () => {
      if (inline.trim()) {
        const paragraph = doc.createElement("p");
        paragraph.textContent = inline;
        elements.push(paragraph);
      }
      inline = "";
    };
    for (const node of container.childNodes) {
      if (node.nodeType === 3) { inline += node.textContent ?? ""; continue; }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (element.matches(semanticBlocks)) {
        flush();
        elements.push(element);
        if (element.matches("li")) {
          for (const list of element.children) if (list.matches("ul, ol")) collect(list);
        }
      } else if (element.matches("div, section, article, main, ul, ol, dl, figure") || element.querySelector(semanticBlocks)) {
        flush();
        collect(element);
      } else {
        inline += element.textContent ?? "";
      }
    }
    flush();
  };
  collect(clone);
  const blocks: string[] = [];
  let skippedHeadingLevel: number | null = null;
  elements.forEach(element => {
    if (/^H[1-6]$/.test(element.tagName)) {
      const level = Number(element.tagName[1]);
      if (skippedHeadingLevel !== null && level <= skippedHeadingLevel) skippedHeadingLevel = null;
      const heading = (element.textContent ?? "").trim().replace(/[:\s]+$/, "").toLowerCase();
      if (/^(references|bibliography|see also|further reading|external links|related (articles|posts|content)|recommended (articles|reading)|you may also like)$/.test(heading)) {
        skippedHeadingLevel = level;
        return;
      }
    }
    if (skippedHeadingLevel !== null) return;
    if (element.parentElement?.closest("table, pre, blockquote")) return;
    if (!element.matches("li") && element.parentElement?.closest("li")) return;
    const plain = (element.textContent ?? "").trim();
    if (element.querySelector("a") && /^(read (also|more)|see also|check (out|more)|related (articles|posts)|you may also like)\b/i.test(plain)) return;
    let content = element;
    if (element.matches("li")) {
      content = element.cloneNode(true) as Element;
      content.querySelectorAll("ul, ol").forEach(list => list.remove());
    }
    const text = meaningfulText(content);
    if (text.length >= 2) blocks.push(text);
  });
  return blocks.join("\n\n").trim();
}
