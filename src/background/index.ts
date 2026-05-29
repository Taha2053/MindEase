// ============================================================
// background/index.ts — Service Worker (persistent background logic)
// Manages session lifecycle and routes messages between layers.
// ============================================================

import browser from "webextension-polyfill";
import type { CognitiveEvent, CognitiveProfile, ContentChunk, ExtensionMessage } from "@/types";
import { startSession, endSession, recordEvent } from "@/layer3/index";

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
      case "SESSION_START": {
        // Start a Layer 3 tracking session with the user's cognitive profile
        const { userId } = msg.payload as { userId: string };
        console.log("[Background] Session started for user:", userId);

        // Retrieve the cognitive profile that Layer 2 computed during onboarding
        browser.storage.local.get("cognitiveProfile").then((result) => {
          const profile = (result as Record<string, unknown>)
            .cognitiveProfile as CognitiveProfile;

          if (!profile) {
            console.warn(
              "[Background] No cognitive profile found — " +
                "starting session with default profile.",
            );
          }

          startSession(userId, profile);
        });
        break;
      }

      case "SESSION_END": {
        // End the session and trigger the Layer 3 synthesis pipeline
        console.log("[Background] Session ended — triggering synthesis.");

        // Retrieve content chunks collected by Layer 1 during the session
        browser.storage.local.get("sessionChunks").then((result) => {
          const chunks = ((result as Record<string, unknown>)
            .sessionChunks ?? []) as ContentChunk[];

          endSession(chunks);
        });
        break;
      }

      case "COGNITIVE_EVENT": {
        // Forward Layer 2 cognitive events (highlight, pause, re-read, etc.)
        // directly to Layer 3 for engagement tracking
        const event = msg.payload as CognitiveEvent;
        recordEvent(event);
        break;
      }

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
