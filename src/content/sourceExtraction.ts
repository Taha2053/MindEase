const REMOVE_SELECTORS = [
  "script", "style", "noscript", "nav", "footer", "aside", "form",
  "[hidden]", "[aria-hidden='true']", "[id^='mindease-']",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']",
  ".mw-editsection", ".mw-jump-link", ".noprint", ".navbox", ".vertical-navbox",
  ".sidebar", ".infobox", ".metadata", ".ambox", ".hatnote", ".shortdescription",
  ".mw-authority-control", ".catlinks", ".printfooter", ".sistersitebox",
  ".vector-page-toolbar", ".vector-dropdown", ".uls-language-list",
  ".reflist", ".references", "#references", "#further-reading", "#external-links",
  ".refbegin", ".portal", ".citation",
  "button", "select", "input", "textarea",
].join(",");

const normalizeBlockText = (value: string): string => value
  .replace(/[\t\f\v ]+/g, " ")
  .replace(/ *\n */g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

function preserveMath(root: ParentNode, doc: Document): void {
  root.querySelectorAll<HTMLElement>(".mwe-math-element, math[alttext], img.mwe-math-fallback-image")
    .forEach(element => {
      const math = element.matches("math[alttext]") ? element : element.querySelector<HTMLElement>("math[alttext]");
      const fallback = element.matches("img") ? element : element.querySelector<HTMLImageElement>("img.mwe-math-fallback-image");
      const tex = math?.getAttribute("alttext") ?? fallback?.getAttribute("alt") ?? "";
      if (tex.trim()) element.replaceWith(doc.createTextNode(` [FORMULA]${tex.trim()}[/FORMULA] `));
    });
}

const meaningfulText = (element: Element): string => {
  const text = normalizeBlockText(element.textContent ?? "");
  if (/^H[1-6]$/.test(element.tagName)) return "#".repeat(Number(element.tagName[1])) + " " + text;
  if (element.matches("li")) return "- " + text;
  if (element.matches("pre")) return "```\n" + text + "\n```";
  if (element.matches("table")) {
    const rows = [...element.querySelectorAll("tr")].map(row => [...row.querySelectorAll("th, td")].map(cell => normalizeBlockText(cell.textContent ?? "").replace(/\|/g, "\\|")));
    if (!rows.length) return "";
    return [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map(row => "| " + row.join(" | ") + " |").join("\n");
  }
  return text;
};

/** Extract only semantic reading blocks in document order. */
export function extractReadingText(doc: Document = document): string {
  const wikipediaRoot = doc.querySelector("#mw-content-text .mw-parser-output");
  const root = wikipediaRoot ?? doc.querySelector("article") ?? doc.querySelector("main, [role='main']") ?? doc.body;
  if (!root) return "";

  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(REMOVE_SELECTORS).forEach(element => element.remove());
  preserveMath(clone, doc);

  const blocks: string[] = [];
  if (wikipediaRoot) {
    const title = normalizeBlockText(doc.querySelector("#firstHeading")?.textContent ?? doc.title);
    if (title) blocks.push("# " + title);
  }
  let stopExtraction = false;
  clone.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, dt, dd, pre, blockquote, figcaption, table").forEach(element => {
    if (stopExtraction) return;
    if (/^H[1-6]$/.test(element.tagName)) {
      const headingText = (element.textContent ?? "").trim().toLowerCase();
      if (["references", "see also", "further reading", "external links", "notes", "bibliography", "sources"].includes(headingText)) {
        stopExtraction = true;
        return;
      }
    }
    if (element.parentElement?.closest("table, pre, blockquote, .reflist, .references")) return;
    if (!element.matches("li") && element.parentElement?.closest("li")) return;
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
