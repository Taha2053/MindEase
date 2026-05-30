/* ============================================================
   background/index.ts — Service Worker (persistent background logic)
   Manages session lifecycle and routes messages between layers.
   Integrates Layer 2 (cognitive profiling) for behavior signals,
   profile getter API, session lifecycle, and content transformation
   via Gemini API (Layer 1).
   ============================================================ */

import browser from "webextension-polyfill";
import type { CognitiveEvent, CognitiveProfile, FullCognitiveProfile, ExtensionMessage, ContentChunk } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { setupLayer2Listeners, endSession as endLayer2Session } from "@/layer2";
import { startSession, endSession as endLayer3Session, recordEvent } from "@/layer3/index";
import { transformContent } from "@/layer1/index";

/* ── Default profile when storage has none ──────────────────────────────────── */
const DEFAULT_PROFILE: CognitiveProfile = {
  userId: "default",
  learningStyle: "text",
  attentionSpan: "medium",
  anchorNeed: false,
  condition: "none",
  updatedAt: Date.now(),
};

const DEFAULT_FULL_PROFILE = {
  ...DEFAULT_PROFILE,
  createdAt: new Date().toISOString(),
  baseline: {
    formatPreference: "text" as const,
    attentionSpan: "medium" as const,
    readingPace: "moderate" as const,
    needsConceptAnchor: false,
    secondLanguageLearner: false,
  },
  rlState: {
    highlightRate: 0,
    pauseRate: 0,
    reReadRate: 0,
    skipRate: 0,
    sessionCount: 0,
    totalEngagementScore: 0,
  },
  transformationParams: {
    chunkSize: "medium" as const,
    simplificationLevel: 2 as const,
    captionSpeed: "normal" as const,
    useVisualAnchors: false,
    summaryFrequency: "medium" as const,
  },
};

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
  (message: unknown, sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    if (msg.type === "TRANSFORM_CONTENT") {
      const { text, pageType } = msg.payload as {
        text: string;
        pageType: "website" | "pdf" | "lecture";
      };
      const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;

      if (!tabId) {
        sendResponse({ received: true });
        return true;
      }

      (async () => {
        const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
        const fullProfile = (result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined) ?? DEFAULT_PROFILE;

        try {
          console.log("[Background] Starting transform for:", pageType);
          const chunks = await transformContent(
            text,
            pageType,
            (fullProfile as FullCognitiveProfile).transformationParams,
          );
          console.log("[Background] Transform complete, chunks:", chunks.length);
          startSession(
            (fullProfile as FullCognitiveProfile).userId ?? "guest",
            fullProfile as unknown as CognitiveProfile,
          );
          // Push result directly to the tab
          await browser.tabs.sendMessage(tabId, { type: "TRANSFORMED_CONTENT", chunks });
        } catch (err) {
          console.error("[Background] Transform failed:", err);
          await browser.tabs.sendMessage(tabId, { type: "TRANSFORM_ERROR", error: String(err) });
        }
      })();

      sendResponse({ received: true }); // immediate sync ACK
      return true;
    }

    // All other synchronous cases
    switch (msg.type) {
      case "PING":
        sendResponse({ pong: true });
        break;

      case "SESSION_START": {
        const { userId } = msg.payload as { userId: string };
        console.log("[Background] Session started for user:", userId);
        browser.storage.local.get(STORAGE_KEYS.PROFILE).then((res) => {
          const profile = (res[STORAGE_KEYS.PROFILE] as CognitiveProfile | undefined);
          if (!profile) console.warn("[Background] No cognitive profile found — starting session with default profile.");
          startSession(userId, profile ?? (DEFAULT_PROFILE as unknown as CognitiveProfile));
        });
        break;
      }

      case "SESSION_END": {
        console.log("[Background] Session ended — triggering synthesis.");
        endLayer3Session();
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
