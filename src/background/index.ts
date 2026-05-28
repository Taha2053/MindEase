// ============================================================
// background/index.ts — Service Worker (persistent background logic)
// Manages session lifecycle and routes messages between layers.
// ============================================================

import browser from "webextension-polyfill";
import type { ExtensionMessage } from "@/types";

// ── Session lifecycle ─────────────────────────────────────────────────────────

// Fired when the extension is installed or updated
browser.runtime.onInstalled.addListener(() => {
  console.log("[MindEase] Extension installed — background worker ready.");
});

// ── Message router ────────────────────────────────────────────────────────────
// All inter-layer communication passes through here.

browser.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    switch (msg.type) {
      case "SESSION_START":
        console.log("[Background] Session started:", msg.payload);
        break;

      case "SESSION_END":
        console.log("[Background] Session ended — triggering synthesis.");
        // TODO: trigger Layer 3 synthesis pipeline
        break;

      case "COGNITIVE_EVENT":
        // Forward Layer 2 events to Layer 3
        // Layer 3 sessionTracker listens for these
        break;

      case "ARTIFACT_READY":
        // Notify popup panel that the knowledge artifact is ready
        browser.action.setBadgeText({ text: "✓" });
        browser.action.setBadgeBackgroundColor({ color: "#7C3AED" });
        break;

      default:
        console.warn("[Background] Unknown message type:", msg.type);
    }

    // Keep message channel open for async responses
    sendResponse({ received: true });
    return true;
  }
);
