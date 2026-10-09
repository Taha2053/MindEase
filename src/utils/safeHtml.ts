import DOMPurify from "dompurify";

/** Replaces an element's children with sanitized HTML without using injection sinks. */
export const replaceSanitizedHtml = (target: Element, html: string): void => {
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  target.replaceChildren(fragment);
};
