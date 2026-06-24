import browser from "webextension-polyfill";
import type { Theme } from "@/utils/themeManager";

const DISMISSED_KEY = "mindease_prompt_dismissed";
const PROMPT_CSS_ID = "mindease-prompt-styles";

function getHostname(): string {
  return window.location.hostname;
}

async function isDismissed(): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(DISMISSED_KEY);
    const dismissed = result[DISMISSED_KEY] as string[] | undefined;
    return dismissed?.includes(getHostname()) ?? false;
  } catch {
    return false;
  }
}

async function markDismissed(): Promise<void> {
  try {
    const result = await browser.storage.local.get(DISMISSED_KEY);
    const dismissed = result[DISMISSED_KEY] as string[] | undefined;
    const updated = [...new Set([...(dismissed ?? []), getHostname()])];
    await browser.storage.local.set({ [DISMISSED_KEY]: updated });
  } catch {
    /* ignore */
  }
}

const STYLES = `
#mindease-discovery-prompt {
  all: initial;
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483646;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  animation: mindease-prompt-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: auto;
}

#mindease-discovery-prompt[data-theme="dark"] {
  --dp-bg: #252A55;
  --dp-border: #7286D3;
  --dp-text: #E5E0FF;
  --dp-text-dim: #B8B8E0;
  --dp-accent: #8EA7E9;
  --dp-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
#mindease-discovery-prompt[data-theme="light"] {
  --dp-bg: #FFF8DE;
  --dp-border: #AAC4F5;
  --dp-text: #2D2B55;
  --dp-text-dim: #6E7FA8;
  --dp-accent: #8CA9FF;
  --dp-shadow: 0 8px 32px rgba(0,0,0,0.12);
}
.mindease-prompt-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  background: var(--dp-bg);
  border: 1px solid var(--dp-border);
  border-radius: 14px;
  box-shadow: var(--dp-shadow);
  backdrop-filter: blur(12px);
  white-space: nowrap;
}
.mindease-prompt-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, #8EA7E9, #E5E0FF);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mindease-prompt-icon svg {
  width: 18px;
  height: 18px;
  color: #1A1D3A;
}
.mindease-prompt-text {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--dp-text);
  line-height: 1.3;
}
.mindease-prompt-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mindease-prompt-btn {
  all: initial;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s, transform 0.15s;
}
.mindease-prompt-btn:hover {
  opacity: 0.85;
  transform: translateY(-1px);
}
.mindease-prompt-btn:active {
  transform: translateY(0);
}
.mindease-prompt-btn-primary {
  background: linear-gradient(135deg, #8EA7E9, #E5E0FF);
  color: #1A1D3A;
}
.mindease-prompt-btn-ghost {
  color: var(--dp-text-dim);
  border: 1px solid var(--dp-border);
  background: transparent;
}
.mindease-prompt-btn-ghost:hover {
  color: var(--dp-text);
  border-color: var(--dp-accent);
}
@keyframes mindease-prompt-in {
  from { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}
@keyframes mindease-prompt-out {
  from { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  to { opacity: 0; transform: translateX(-50%) translateY(12px) scale(0.95); }
}
@media (prefers-reduced-motion: reduce) {
  #mindease-discovery-prompt {
    animation: none;
  }
}
@media (max-width: 600px) {
  .mindease-prompt-card {
    flex-wrap: wrap;
    justify-content: center;
    white-space: normal;
    max-width: 90vw;
    padding: 12px 16px;
  }
}
`;

const BRAIN_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/><path d="M6 18a4 4 0 0 1-2-7.464"/></svg>`;

export async function showDiscoveryPrompt(theme: Theme, onEnable: () => void): Promise<void> {
  if (await isDismissed()) return;
  if (document.getElementById("mindease-discovery-prompt")) return;

  const excludeHosts = ["netflix.com", "twitch.tv", "discord.com", "whatsapp.com", "snapchat.com", "imgur.com"];
  if (excludeHosts.some(h => getHostname().includes(h))) return;

  const style = document.createElement("style");
  style.id = PROMPT_CSS_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);

  const prompt = document.createElement("div");
  prompt.id = "mindease-discovery-prompt";
  prompt.setAttribute("data-theme", theme);

  prompt.innerHTML = `
    <div class="mindease-prompt-card">
      <div class="mindease-prompt-icon">${BRAIN_SVG}</div>
      <span class="mindease-prompt-text">Want MindEase for this page?</span>
      <div class="mindease-prompt-actions">
        <button class="mindease-prompt-btn mindease-prompt-btn-primary" id="mindease-prompt-enable">Enable</button>
        <button class="mindease-prompt-btn mindease-prompt-btn-ghost" id="mindease-prompt-dismiss">Not now</button>
      </div>
    </div>
  `;

  document.body.appendChild(prompt);

  prompt.querySelector("#mindease-prompt-enable")?.addEventListener("click", () => {
    cleanup();
    onEnable();
  });

  prompt.querySelector("#mindease-prompt-dismiss")?.addEventListener("click", () => {
    cleanup();
    markDismissed();
  });

  let autoTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    cleanup();
  }, 10000);

  function cleanup(): void {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    const el = document.getElementById("mindease-discovery-prompt");
    if (el) {
      el.style.animation = "mindease-prompt-out 0.2s ease both";
      setTimeout(() => el.remove(), 200);
    }
    document.getElementById(PROMPT_CSS_ID)?.remove();
  }
}
