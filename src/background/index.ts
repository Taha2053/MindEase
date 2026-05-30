/* ============================================================
   background/index.ts — Service Worker (persistent background logic)
   Manages session lifecycle and routes messages between layers.
   Integrates Layer 2 (cognitive profiling) for behavior signals,
   profile getter API, session lifecycle, and content transformation
   via Gemini API (Layer 1).
   ============================================================ */

import browser from "webextension-polyfill";
import type { CognitiveEvent, CognitiveProfile, FullCognitiveProfile, ExtensionMessage, TransformationParams, ContentChunk } from "@/types";
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
    const msg = message as Record<string, unknown>;

    switch (msg.type) {
      case "SESSION_START": {
        const payload = msg.payload as { userId: string } | undefined;
        const userId = payload?.userId ?? "guest";
        console.log("[Background] Session started for user:", userId);

        browser.storage.local.get(STORAGE_KEYS.PROFILE).then((result) => {
          const profile = (result[STORAGE_KEYS.PROFILE] as CognitiveProfile | undefined) ?? DEFAULT_PROFILE;

          if (!result[STORAGE_KEYS.PROFILE]) {
            console.warn("[Background] No cognitive profile found — starting session with default profile.");
          }

          startSession(userId, profile);
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

      case "TRANSFORM_CONTENT": {
        const { text, pageType } = msg.payload as { text: string; pageType: "website" | "pdf" | "lecture" };

        browser.storage.local.get(STORAGE_KEYS.PROFILE).then(async (result) => {
          const fullProfile = (result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined) ?? DEFAULT_FULL_PROFILE;
          const params: TransformationParams = fullProfile.transformationParams;

          try {
            const sourceUrl = (sender as { url?: string } | undefined)?.url;
            const chunks = await transformContent(text, pageType, params, sourceUrl);

            /* Start Layer 3 session if not already */
            startSession(fullProfile.userId, fullProfile);

            sendResponse({ type: "TRANSFORMED_CONTENT", chunks });
          } catch (err) {
            console.error("[Background] Transform failed:", err);
            sendResponse({ type: "TRANSFORMED_CONTENT", chunks: [] });
          }
        });

        return true; /* keep channel open for async response */
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
