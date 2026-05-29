/* ============================================================
   background/index.ts — Service Worker (persistent background logic)
   Manages session lifecycle and routes messages between layers.
   Integrates Layer 2 (cognitive profiling) for behavior signals,
   profile getter API, and session lifecycle.
   ============================================================ */

import browser from "webextension-polyfill";
import type { CognitiveEvent, CognitiveProfile, ContentChunk, ExtensionMessage } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { setupLayer2Listeners, endSession as endLayer2Session } from "@/layer2";
import { startSession, endSession as endLayer3Session, recordEvent } from "@/layer3/index";

/* ── Session lifecycle ───────────────────────────────────────────────────────── */

browser.runtime.onInstalled.addListener((details) => {
  console.log("[MindEase] Extension installed — background worker ready.", details.reason);

  if (details.reason === "install") {
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
  await endLayer2Session();
});

/* ── Message router ──────────────────────────────────────────────────────────── */

browser.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    switch (msg.type) {
      case "SESSION_START": {
        const { userId } = msg.payload as { userId: string };
        console.log("[Background] Session started for user:", userId);

        browser.storage.local.get(STORAGE_KEYS.PROFILE).then((result) => {
          const profile = (result as Record<string, unknown>)
            [STORAGE_KEYS.PROFILE] as CognitiveProfile;

          if (!profile) {
            console.warn("[Background] No cognitive profile found — starting session with default profile.");
          }

          startSession(userId, profile);
        });
        break;
      }

      case "SESSION_END": {
        console.log("[Background] Session ended — triggering synthesis.");

        endLayer3Session([]);
        endLayer2Session();
        break;
      }

      case "COGNITIVE_EVENT": {
        const event = msg.payload as CognitiveEvent;
        recordEvent(event);
        break;
      }

      case "ARTIFACT_READY":
        browser.action.setBadgeText({ text: "✓" });
        browser.action.setBadgeBackgroundColor({ color: "#7C3AED" });
        break;

      default:
        break;
    }

    sendResponse({ received: true });
    return true;
  }
);
