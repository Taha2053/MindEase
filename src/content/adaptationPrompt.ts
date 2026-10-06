import { appendToShadow, getMindeaseShadow, shadowById } from "./shadowHost";
import type { Theme } from "@/utils/themeManager";
import type { BaselineProfile } from "@/types";
import { rankAdaptations } from "@/layer2/recommendations";

export type AdaptationChoice = { adaptation: "structured" | "visual"; language: "preferred" | "source" };

const STYLE_ID = "mindease-adaptation-prompt-style";
const PROMPT_ID = "mindease-adaptation-prompt";
let cancelPendingPrompt: (() => void) | undefined;

export function dismissAdaptationChoice(): void {
  cancelPendingPrompt?.();
}

const STYLES = `
#${PROMPT_ID} { all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;
  width: min(360px, calc(100vw - 32px)); font-family: Inter, system-ui, sans-serif; color: var(--ap-text); }
#${PROMPT_ID}[data-theme="dark"] { --ap-bg:#171717; --ap-text:#d4d4d4; --ap-dim:rgba(212,212,212,.78); --ap-border:rgba(212,212,212,.24); --ap-accent:#d4d4d4; }
#${PROMPT_ID}[data-theme="light"] { --ap-bg:#d4d4d4; --ap-text:#171717; --ap-dim:rgba(23,23,23,.74); --ap-border:rgba(23,23,23,.22); --ap-accent:#171717; }
#${PROMPT_ID} .ap-card { background:var(--ap-bg); border:2px solid var(--ap-border); border-radius:16px;
  box-shadow:0 12px 40px rgba(0,0,0,.3); padding:18px; }
#${PROMPT_ID} h2 { all:initial; display:block; color:var(--ap-text); font:700 1rem/1.35 Inter,system-ui,sans-serif; margin-bottom:6px; }
#${PROMPT_ID} p { all:initial; display:block; color:var(--ap-dim); font:400 .85rem/1.5 Inter,system-ui,sans-serif; margin-bottom:14px; }
#${PROMPT_ID} .ap-options { display: flex; flex-direction: column; gap: 8px; }
#${PROMPT_ID} button { all: initial; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 100%; border: 1px solid var(--ap-border);
  border-radius: 9px; padding: 10px 14px; cursor: pointer; color: var(--ap-text); font: 600 .85rem/1.3 Inter, system-ui, sans-serif; transition: all 0.15s ease; text-align: center; }
#${PROMPT_ID} button:hover, #${PROMPT_ID} button:focus-visible { outline: 2px solid var(--ap-accent); outline-offset: 1px; }
#${PROMPT_ID} button[data-primary="true"] { background: var(--ap-accent); color: var(--ap-bg); font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
#${PROMPT_ID} button[data-primary="true"]:hover { opacity: 0.92; }
#${PROMPT_ID} .ap-cancel-btn { background: color-mix(in srgb, var(--ap-dim) 10%, transparent); border-color: var(--ap-border); color: var(--ap-dim); margin-top: 4px; }
#${PROMPT_ID} .ap-cancel-btn:hover { background: color-mix(in srgb, var(--ap-dim) 18%, transparent); color: var(--ap-text); }
#${PROMPT_ID} .ap-cancel-btn.secondary { background: transparent; border-color: transparent; font-weight: 500; }
#${PROMPT_ID} .ap-cancel-btn.secondary:hover { text-decoration: underline; background: transparent; }
#${PROMPT_ID} .ap-language { display: flex; align-items: flex-start; gap: 10px; margin: 12px 0 16px; color: var(--ap-text); font: 400 .82rem/1.4 Inter, system-ui, sans-serif; cursor: pointer; user-select: none; }
#${PROMPT_ID} .ap-language input { width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; accent-color: var(--ap-accent); cursor: pointer; }
#${PROMPT_ID} .ap-language span.ap-desc { flex: 1; }
@media (prefers-reduced-motion: reduce) { #${PROMPT_ID} * { scroll-behavior:auto !important; transition:none !important; } }
`;

export function requestAdaptationChoice(theme: Theme, baseline?: Partial<BaselineProfile>): Promise<AdaptationChoice | null> {
  cancelPendingPrompt?.();
  shadowById(PROMPT_ID)?.remove();
  shadowById(STYLE_ID)?.remove();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  getMindeaseShadow().appendChild(style);

  const prompt = document.createElement("section");
  prompt.id = PROMPT_ID;
  prompt.dataset.theme = theme;
  prompt.setAttribute("role", "dialog");
  prompt.setAttribute("aria-labelledby", "mindease-adaptation-title");
  prompt.setAttribute("aria-describedby", "mindease-adaptation-description");
  prompt.innerHTML = `
    <div class="ap-card">
      <h2 id="mindease-adaptation-title">Adapt this learning material?</h2>
      <p id="mindease-adaptation-description">Accepting sends this source to your configured MindEase server or DeepSeek. Visual options also send selected sections to Napkin. Generated explanations may contain errors.</p>
      <div class="ap-options">
        <div class="ap-recommendations"></div>
      </div>
        ${baseline?.preferredLanguage ? '<label class="ap-language"><input type="checkbox" class="ap-language-check" checked><span class="ap-desc">Use my preferred learning language (<strong class="ap-language-name"></strong>) for the adaptation. Uncheck to use the source language.</span></label>' : ""}
      <div class="ap-actions" style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
        <button type="button" class="ap-cancel-btn" data-choice="alternative">Suggest another option</button>
        <button type="button" class="ap-cancel-btn secondary" data-choice="cancel">Keep the original page</button>
      </div>
    </div>`;
  const languageName = prompt.querySelector(".ap-language-name");
  if (languageName) languageName.textContent = baseline?.preferredLanguage ?? "";
  const recommendations = rankAdaptations(baseline);
  const options = prompt.querySelector(".ap-recommendations")!;
  const showOption = (index: number) => {
    options.replaceChildren();
    const recommendation = recommendations[index];
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.choice = recommendation.choice;
    button.dataset.primary = "true";
    button.textContent = recommendation.label;
    const reason = document.createElement("p");
    reason.textContent = recommendation.reason;
    options.append(button, reason);
  };
  showOption(0);
  appendToShadow(prompt);

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const firstButton = prompt.querySelector<HTMLButtonElement>("button");
  firstButton?.focus();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice: AdaptationChoice | null) => {
      if (settled) return;
      settled = true;
      cancelPendingPrompt = undefined;
      prompt.remove();
      style.remove();
      previouslyFocused?.focus();
      resolve(choice);
    };
    cancelPendingPrompt = () => finish(null);

    prompt.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button[data-choice]");
      if (!button) return;
      const choice = button.dataset.choice;
      if (choice === "alternative") {
        showOption(1);
        button.remove();
        options.querySelector<HTMLButtonElement>("button")?.focus();
        return;
      }
      finish(choice === "structured" || choice === "visual"
        ? { adaptation: choice, language: prompt.querySelector<HTMLInputElement>(".ap-language-check")?.checked ? "preferred" : "source" }
        : null);
    });
    prompt.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
    });
  });
}
