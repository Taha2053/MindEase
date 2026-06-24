import katex from "katex";

export function renderLatex(text: string): string {
  let result = text
    // Display math: $$...$$ and \[...\]
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false });
      } catch {
        return `<span class="latex-error">${formula}</span>`;
      }
    })
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false });
      } catch {
        return `<span class="latex-error">${formula}</span>`;
      }
    })
    // Inline math: $...$ and \(...\)
    .replace(/\$([^\s$][^$]*[^\s$])\$/g, (_, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false });
      } catch {
        return `<span class="latex-error">${formula}</span>`;
      }
    })
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false });
      } catch {
        return `<span class="latex-error">${formula}</span>`;
      }
    });

  return result;
}
