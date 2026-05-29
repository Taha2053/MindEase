/* ============================================================
   background/index.ts — Service Worker (persistent background logic)
   Manages session lifecycle and routes messages between layers.
   Integrates Layer 2 (cognitive profiling) for behavior signals,
   profile getter API, and session lifecycle.
   ============================================================ */

import browser from "webextension-polyfill";
import type { ExtensionMessage } from "@/types";
import { setupLayer2Listeners, endSession } from "@/layer2";

/* ── Session lifecycle ───────────────────────────────────────────────────────── */

browser.runtime.onInstalled.addListener((details) => {
  console.log("[MindEase] Extension installed — background worker ready.", details.reason);

  if (details.reason === "install") {
    /* Open onboarding in a new tab on first install */
    browser.tabs.create({
      url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"),
      active: true,
    });
  }
});

/* ── Initialize Layer 2 ─────────────────────────────────────────────────────── */
setupLayer2Listeners();

/* ── Tab close → trigger session end ────────────────────────────────────────── */
browser.tabs.onRemoved.addListener(async (_tabId) => {
  await endSession();
});

/* ── Message router ────────────────────────────────────────────────────────────
     All inter-layer communication passes through here.
     Layer 2 handles its own messages via setupLayer2Listeners().
     We also handle Layer 3 and general routing here.
  ─────────────────────────────────────────────────────────────────────────────── */

browser.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    switch (msg.type) {
      case "SESSION_START":
        console.log("[Background] Session started:", msg.payload);
        break;

      case "SESSION_END":
        console.log("[Background] Session ended — triggering synthesis.");
        break;

      case "COGNITIVE_EVENT":
        /* Forward Layer 2 events to Layer 3
           Layer 3 sessionTracker listens for these */
        break;

      case "ARTIFACT_READY":
        browser.action.setBadgeText({ text: "✓" });
        browser.action.setBadgeBackgroundColor({ color: "#7C3AED" });
        break;

      default:
        /* Messages handled by Layer 2's own listener will return a response.
           Unknown messages are logged. */
        break;
    }

    sendResponse({ received: true });
    return true;
  }
);
