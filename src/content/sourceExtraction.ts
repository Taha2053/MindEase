/** Extract the current main reading region without including MindEase UI. */
export function extractReadingText(doc: Document = document): string {
  const root = doc.querySelector("article") ?? doc.querySelector("main, [role='main']") ?? doc.body;
  if (!root) return "";
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, noscript, nav, [hidden], [aria-hidden='true'], [id^='mindease-']")
    .forEach(element => element.remove());
  // textContent preserves literal citation/formula text; explicit separators
  // preserve structural boundaries in the detached copy without touching DOM.
  clone.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, tr, section, div")
    .forEach(element => element.appendChild(doc.createTextNode("\n\n")));
  clone.querySelectorAll("br").forEach(element => element.replaceWith(doc.createTextNode("\n")));
  return clone.textContent?.trim() ?? "";
}
