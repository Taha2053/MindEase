import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import browser from "webextension-polyfill";
import katexStyles from "@/styles/formulas.css?url";

/** Render untrusted lesson text, keeping TeX outside Markdown's escape processing. */
export const renderMarkdown = (source: string): string => {
  if (!document.getElementById("mindease-katex-css")) {
    const stylesheet = document.createElement("link");
    stylesheet.id = "mindease-katex-css"; stylesheet.rel = "stylesheet";
    stylesheet.href = browser.runtime.getURL(katexStyles.replace(/^\//, ""));
    document.head.appendChild(stylesheet);
  }
  const math: string[] = [];
  const text = source.replace(/```[\s\S]*?```|`[^`\n]+`|\[FORMULA\]([\s\S]*?)\[\/FORMULA\]|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/g,
    (match, tagged, dollars, brackets, inline, single) => {
      if (match.startsWith("`")) return match;
      const formula = tagged ?? dollars ?? brackets ?? inline ?? single;
      const token = `MINDEASEMATHPLACEHOLDER${math.length}END`;
      math.push(katex.renderToString(formula.trim(), { displayMode: tagged !== undefined || dollars !== undefined || brackets !== undefined, throwOnError: false, trust: false, output: "htmlAndMathml" }));
      return token;
    });
  const safe = DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ["img", "style", "input", "form"],
  });
  return safe.replace(/MINDEASEMATHPLACEHOLDER(\d+)END/g, (_, index) => math[Number(index)] ?? "");
};
