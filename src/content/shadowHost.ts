/* ============================================================
   content/shadowHost.ts — Shadow DOM isolation for MindEase UI
   All MindEase injected UI lives inside a single shadow root so
   that host-page CSS cannot break extension controls and
   extension styles cannot leak into the host page.
   ============================================================ */

import browser from "webextension-polyfill";
import formulaStyles from "@/styles/formulas.css?url";

let _host: HTMLDivElement | null = null;
let _shadow: ShadowRoot | null = null;

/**
 * Return the open shadow root that contains all MindEase UI.
 * Creates the host element + shadow root on first call.
 */
export function getMindeaseShadow(): ShadowRoot {
  if (_shadow) return _shadow;

  _host = document.createElement("div");
  _host.id = "mindease-shadow-host";
  // The host itself must not be affected by page layout.
  // `all: initial` prevents inheritance; positioning is handled
  // inside the shadow tree by each component.
  _host.style.cssText =
    "all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;overflow:visible!important;z-index:2147483647!important;pointer-events:none!important;";
  document.documentElement.appendChild(_host);

  _shadow = _host.attachShadow({ mode: "open" });

  // A base reset that applies to everything inside the shadow tree.
  const reset = document.createElement("style");
  reset.textContent = `
    :host { all: initial; pointer-events: none; }
    :host {
      --bg-surface: #171717; --text-primary: #d4d4d4;
      --text-dim: #b8b8b8; --border: #555; --danger: #ff8585;
      --shadow: 0 12px 40px rgba(0,0,0,.3);
      font: 400 16px/1.5 system-ui, sans-serif;
      color: var(--text-primary); color-scheme: dark;
    }
    *, *::before, *::after { box-sizing: border-box; }
  `;
  _shadow.appendChild(reset);
  // Shadow trees cannot use the document's KaTeX stylesheet.
  const mathStyles = document.createElement("link");
  mathStyles.id = "mindease-katex-css";
  mathStyles.rel = "stylesheet";
  mathStyles.href = browser.runtime.getURL(formulaStyles.replace(/^\//, ""));
  _shadow.appendChild(mathStyles);

  return _shadow;
}

/**
 * Inject a <style> block into the shadow root. Idempotent per id.
 */
export function injectShadowStyle(id: string, css: string): void {
  const shadow = getMindeaseShadow();
  if (shadow.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  shadow.appendChild(el);
}

/**
 * Remove a previously injected style from the shadow root.
 */
export function removeShadowStyle(id: string): void {
  const shadow = getMindeaseShadow();
  shadow.getElementById(id)?.remove();
}

/**
 * Append a DOM element to the shadow root (for popups, overlays, etc.).
 */
export function appendToShadow(el: HTMLElement): void {
  const shadow = getMindeaseShadow();
  el.style.pointerEvents = "auto";
  shadow.appendChild(el);
}

/**
 * Query inside the shadow root by ID.
 */
export function shadowById(id: string): HTMLElement | null {
  return (getMindeaseShadow().getElementById(id) as HTMLElement) ?? null;
}

/**
 * querySelector scoped to the shadow root.
 */
export function shadowQuery<T extends HTMLElement = HTMLElement>(
  selector: string,
): T | null {
  return getMindeaseShadow().querySelector<T>(selector);
}

/**
 * querySelectorAll scoped to the shadow root.
 */
export function shadowQueryAll<T extends HTMLElement = HTMLElement>(
  selector: string,
): NodeListOf<T> {
  return getMindeaseShadow().querySelectorAll<T>(selector);
}
