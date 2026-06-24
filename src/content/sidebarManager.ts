/* ============================================================
   content/sidebarManager.ts - Sidebar Recovery System
   Persists overlay state (visible, minimized, side, activeTab)
   and provides a floating reopen button with state restoration.
   ============================================================ */

import browser from "webextension-polyfill";
import type { Theme } from "@/utils/themeManager";

const SIDEBAR_STORAGE_KEY = "mindease_sidebar_state";
const SIDEBAR_CSS_ID = "mindease-reopen-styles";

/* ── Types ── */

export interface SidebarState {
  visible: boolean;
  minimized: boolean;
  onRight: boolean;
  activeTab: "content" | "visuals" | "profile" | "session";
  lastScrollY: number;
}

const DEFAULT_STATE: SidebarState = {
  visible: true,
  minimized: false,
  onRight: true,
  activeTab: "content",
  lastScrollY: 0,
};

/* ── Persistence ── */

export async function saveSidebarState(state: Partial<SidebarState>): Promise<void> {
  const current = await loadSidebarState();
  const merged = { ...current, ...state };
  await browser.storage.local.set({ [SIDEBAR_STORAGE_KEY]: merged });
}

export async function loadSidebarState(): Promise<SidebarState> {
  try {
    const result = await browser.storage.local.get(SIDEBAR_STORAGE_KEY);
    if (result[SIDEBAR_STORAGE_KEY]) {
      return { ...DEFAULT_STATE, ...result[SIDEBAR_STORAGE_KEY] };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_STATE };
}

export async function clearSidebarState(): Promise<void> {
  await browser.storage.local.remove(SIDEBAR_STORAGE_KEY);
}

/* ── Reopen Button ── */

let reopenBtn: HTMLButtonElement | null = null;

export function injectReopenButton(theme: Theme): HTMLButtonElement {
  removeReopenButton();

  reopenBtn = document.createElement("button");
  reopenBtn.id = "mindease-reopen-btn";
  reopenBtn.setAttribute("aria-label", "Reopen MindEase panel");
  reopenBtn.setAttribute("title", "Reopen MindEase");
  reopenBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
  `;

  Object.assign(reopenBtn.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: theme === "light"
      ? "linear-gradient(135deg, #3b82f6, #8b5cf6)"
      : "linear-gradient(135deg, #4EB8FF, #7B6FFF)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "2147483646",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
    color: "#fff",
    transition: "transform 0.15s, box-shadow 0.15s",
  });

  reopenBtn.addEventListener("mouseenter", () => {
    if (reopenBtn) {
      reopenBtn.style.transform = "scale(1.1)";
      reopenBtn.style.boxShadow = "0 6px 24px rgba(0,0,0,0.45)";
    }
  });
  reopenBtn.addEventListener("mouseleave", () => {
    if (reopenBtn) {
      reopenBtn.style.transform = "scale(1)";
      reopenBtn.style.boxShadow = "0 4px 16px rgba(0,0,0,0.35)";
    }
  });

  document.body.appendChild(reopenBtn);
  return reopenBtn;
}

export function removeReopenButton(): void {
  if (reopenBtn && reopenBtn.parentNode) {
    reopenBtn.parentNode.removeChild(reopenBtn);
  }
  reopenBtn = null;
}

export function getReopenButton(): HTMLButtonElement | null {
  return reopenBtn;
}

/* ── Inject inline CSS for button animation ── */

export function ensureReopenStyles(): void {
  if (document.getElementById(SIDEBAR_CSS_ID)) return;
  const style = document.createElement("style");
  style.id = SIDEBAR_CSS_ID;
  style.textContent = `
    @keyframes mindease-reopen-in {
      from { opacity: 0; transform: scale(0.5) translateY(16px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes mindease-reopen-pulse {
      0%, 100% { box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
      50% { box-shadow: 0 4px 24px rgba(78,184,255,0.5); }
    }
    #mindease-reopen-btn {
      animation: mindease-reopen-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    #mindease-reopen-btn:focus-visible {
      outline: 2px solid var(--border-focus, #4EB8FF);
      outline-offset: 3px;
    }
    @media (prefers-reduced-motion: reduce) {
      #mindease-reopen-btn {
        animation: none;
      }
    }
  `;
  document.head.appendChild(style);
}
