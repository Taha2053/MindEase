/* ============================================================
   background/index.ts — Service Worker (persistent background logic)
   Manages session lifecycle and routes messages between layers.
   Integrates Layer 2 (cognitive profiling) for behavior signals,
   profile getter API, session lifecycle, and content transformation
   via Gemini API (Layer 1).
   ============================================================ */

import browser from "webextension-polyfill";
import type {
  CognitiveEvent, CognitiveProfile, FullCognitiveProfile,
  ExtensionMessage, ContentChunk, SignalType,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import { setupLayer2Listeners, endSession as endLayer2Session, getCurrentProfile } from "@/layer2";
import { startSession, endSession as endLayer3Session, recordEvent } from "@/layer3/index";
import { transformContent } from "@/layer1/index";
import { SessionManager } from "@/session/SessionManager";

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
    infoDensity: "detailed" as const,
    learningApproach: "theory-first" as const,
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

/* ── Session Manager (Study Workspace) ────────────────────────────────────────── */
const sessionManager = new SessionManager();

// Wire SessionManager callbacks into existing layers
sessionManager.onLayer2Signal = async (signal: SignalType, url: string, sectionId: string) => {
  // Import handleBehaviorSignal dynamically to avoid circular deps
  const { handleBehaviorSignal } = await import("@/layer2");
  await handleBehaviorSignal(signal, url, sectionId);
};
sessionManager.onLayer3Event = (event: CognitiveEvent) => {
  recordEvent(event);
};
sessionManager.onLayer3EndSession = async (chunks?: ContentChunk[]) => {
  await endLayer3Session(chunks);
};
sessionManager.onLayer2EndSession = async () => {
  return endLayer2Session();
};

// Initialize — try to restore workspace from storage
sessionManager.init();

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

/* ── Tab close → notify SessionManager ──────────────────────────────────────── */
browser.tabs.onRemoved.addListener(async (tabId) => {
  sessionManager.removeTab(tabId);
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
        // Register tab in workspace if not already
        const sourceType = pageType === "lecture" ? "website" : pageType;
        const url = (sender as { tab?: { url?: string } } | undefined)?.tab?.url ?? "";
        const title = (sender as { tab?: { title?: string } } | undefined)?.tab?.title ?? "";
        sessionManager.registerTab(tabId, url, sourceType as "pdf" | "video" | "website", title);
        sessionManager.onActivity();

        const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
        const stored = result[STORAGE_KEYS.PROFILE] as Record<string, unknown> | undefined;
        const fullProfile: FullCognitiveProfile = (stored?.transformationParams
          ? stored
          : DEFAULT_FULL_PROFILE) as FullCognitiveProfile;

        try {
          console.log("[Background] Starting transform for:", pageType);
          const chunks = await transformContent(
            text,
            pageType,
            fullProfile.transformationParams,
          );
          console.log("[Background] Transform complete, chunks:", chunks.length);
          await browser.tabs.sendMessage(tabId, { type: "TRANSFORMED_CONTENT", chunks });
        } catch (err) {
          console.error("[Background] Transform failed:", err);
          await browser.tabs.sendMessage(tabId, { type: "TRANSFORM_ERROR", error: String(err) });
        }
      })();

      sendResponse({ received: true });
      return true;
    }

    switch (msg.type) {
      case "PING":
        sendResponse({ pong: true });
        break;

      case "SESSION_START": {
        const payload = msg.payload as Record<string, unknown>;
        const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        const url = (sender as { tab?: { url?: string } } | undefined)?.tab?.url ?? String(payload?.url ?? "");
        const sourceType = (payload?.sourceType ?? "website") as "pdf" | "video" | "website" | "lecture";
        const title = String(payload?.title ?? (sender as { tab?: { title?: string } } | undefined)?.tab?.title ?? "");

        // Register tab in workspace
        if (tabId) {
          sessionManager.registerTab(tabId, url, sourceType === "lecture" ? "website" : sourceType, title);
        }

        // Start Layer 3 session if not already started
        if (!sessionManager.getSessionId()) {
          const userId = String(payload?.userId ?? "guest");
          browser.storage.local.get(STORAGE_KEYS.PROFILE).then((res) => {
            const stored = res[STORAGE_KEYS.PROFILE] as Record<string, unknown> | undefined;
            const profile: CognitiveProfile = (stored?.transformationParams
              ? stored
              : DEFAULT_FULL_PROFILE) as unknown as CognitiveProfile;
            startSession(userId, profile);
          });
        }
        break;
      }

      case "SESSION_END": {
        console.log("[Background] Session ended via user action.");
        sessionManager.endSession();
        break;
      }

      case "COGNITIVE_EVENT": {
        const event = msg.payload as CognitiveEvent;
        sessionManager.onActivity();
        recordEvent(event);
        break;
      }

      case "HIGHLIGHT_NOTE": {
        const notePayload = msg.payload as { text: string; tabId: number; sectionId?: string };
        sessionManager.recordHighlight(notePayload.tabId, notePayload.text, notePayload.sectionId);
        break;
      }

      case "ACTIVITY_PING": {
        sessionManager.onActivity();
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
