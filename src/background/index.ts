import { extractRemoteSource } from "@/layer1/premiumClient";
/* ============================================================
   background/index.ts - Service Worker (persistent background logic)
   Manages session lifecycle and routes messages between layers.
   Integrates Layer 2 (cognitive profiling) for behavior signals,
   profile getter API, session lifecycle, and content transformation
   via Gemini API (Layer 1).
   ============================================================ */

import browser from "webextension-polyfill";
import { v4 as uuidv4 } from "uuid";
import type {
  CognitiveEvent, CognitiveProfile, FullCognitiveProfile,
  ExtensionMessage, ContentChunk, SignalType, HighlightNote, NotesCollection,
  TabResource, FocusSummary, VisualEntry,
  KeyConceptEntry, ResourceEntry,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import { setupLayer2Listeners, endSession as endLayer2Session, getCurrentProfile } from "@/layer2";
import { startSession, restoreSession, endSession as endLayer3Session, recordEvent } from "@/layer3/index";
import { transformContent } from "@/layer1/index";
import { isTransformRequest } from "@/layer1/transformRequest";
import { isExcludedPage } from "@/utils/pagePrivacy";
import { classifyContent, explainSelection } from "@/layer1/llmClient";
import { findRelatedResources } from "@/layer1/resourceRecommendations";
import { generateVisualsForConcepts, generateVisualsFromChunks } from "@/layer1/visualOrchestrator";
import { ocrImageUrl, ocrImageBase64 } from "@/layer1/ocrClient";
import { SessionManager } from "@/session/SessionManager";
import { saveSessionHistory } from "@/session/sessionHistory";

/* ── Offscreen audio helpers (Chrome MV3, bypass content-script autoplay) ─── */
async function ensureOffscreenDocument(): Promise<boolean> {
  const offscreenApi = (globalThis as unknown as { chrome?: any }).chrome?.offscreen;
  if (!offscreenApi || typeof offscreenApi.hasDocument !== "function") return false;
  try {
    if (await offscreenApi.hasDocument()) return true;
    await offscreenApi.createDocument({
      url: browser.runtime.getURL("src/offscreen/offscreen.html"),
      reasons: ["AUDIO_PLAYBACK"] as unknown as string[],
      justification: "Play Azure TTS audio from sidebar without autoplay blocking",
    });
    return true;
  } catch (err) {
    console.warn("[Background] ensureOffscreenDocument failed:", err);
    return false;
  }
}

/* ── Aggregated notes helpers ────────────────────────────────────────────────── */

async function loadAggregatedNotes(): Promise<NotesCollection> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.NOTES);
    return (result[STORAGE_KEYS.NOTES] as NotesCollection) ?? { notes: [], updatedAt: 0 };
  } catch {
    return { notes: [], updatedAt: 0 };
  }
}

async function saveAggregatedNote(note: HighlightNote): Promise<void> {
  const collection = await loadAggregatedNotes();
  collection.notes.push(note);
  collection.updatedAt = Date.now();
  try {
    await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: collection });
  } catch (err) {
    console.warn("[MindEase] Notes save failed:", err);
  }
}

/* ── Extract concepts from ContentChunk[] ─────────────────────────────────────── */

function extractConceptsFromChunks(chunks: ContentChunk[]): string[] {
  const concepts = new Set<string>();
  for (const chunk of chunks) {
    for (const tag of chunk.conceptTags) {
      const cleaned = tag.trim();
      if (cleaned) concepts.add(cleaned);
    }
    // Also extract from [CONCEPT: ...] inline markers
    const matches = chunk.text.match(/\[CONCEPT:\s*([^\]]+)\]/g);
    if (matches) {
      for (const m of matches) {
        const concept = m.replace(/\[CONCEPT:\s*|\]/g, "").trim();
        if (concept) concepts.add(concept);
      }
    }
  }
  return [...concepts];
}

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
sessionManager.onLayer3EndSession = async (
  chunks?: ContentChunk[],
  highlights?: HighlightNote[] | null,
  tabs?: TabResource[] | null,
  focus?: FocusSummary | null,
) => {
  await endLayer3Session(chunks, highlights, tabs, focus);

  // Save session history entry for the dashboard
  try {
    const result = await browser.storage.local.get("latestArtifact");
    const artifact = result.latestArtifact as Record<string, unknown> | undefined;
    if (artifact?.sessionId) {
      const sessionId = artifact.sessionId as string;
      const endTime = (artifact.generatedAt as number) ?? Date.now();
      const durationMs = ((artifact.focusSummary as Record<string, unknown>)?.totalDurationMs as number) ?? 0;
      const concepts = (artifact.keyConcepts as KeyConceptEntry[]) ?? [];
      const focusScore = ((artifact.focusSummary as Record<string, unknown>)?.focusScore as number) ?? 0;
      const resources = (artifact.resourcesUsed as ResourceEntry[]) ?? [];
      const wsResult = await browser.storage.local.get(STORAGE_KEYS.WORKSPACE);
      const ws = wsResult[STORAGE_KEYS.WORKSPACE] as Record<string, unknown> | undefined;
      const actualDuration = ws?.endTime && ws?.startTime
        ? (ws.endTime as number) - (ws.startTime as number)
        : durationMs;
      await saveSessionHistory(sessionId, endTime, actualDuration, concepts, focusScore, resources);
    }
  } catch (err) {
    console.warn("[Background] Failed to save session history:", err);
  }

  // Auto-open dashboard after session ends
  browser.tabs.create({
    url: browser.runtime.getURL("src/session/dashboard/dashboard.html"),
    active: true,
  }).catch(() => {});
};
sessionManager.onLayer2EndSession = async () => {
  return endLayer2Session(sessionManager.getSessionId() ?? undefined);
};

const sessionReady = Promise.all([sessionManager.init(), restoreSession()]);

/* ── Context Menus ─────────────────────────────────────────────────────────── */

function setupContextMenus(): void {
  browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: "mindease-explain",
    title: "Explain with MindEase",
    contexts: ["selection"],
  });
  browser.contextMenus.create({
    id: "mindease-capture",
    title: "Capture & Explain with MindEase",
    contexts: ["page", "image", "video"],
  });
  browser.contextMenus.create({
    id: "mindease-ocr",
    title: "Extract text with MindEase",
    contexts: ["image"],
  });
  browser.contextMenus.create({
    id: "mindease-tts",
    title: "Read aloud with MindEase",
    contexts: ["selection"],
  });
}

browser.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (!tabId) return;

  if (info.menuItemId === "mindease-explain") {
    const text = info.selectionText?.trim();
    if (!text || text.length < 3) return;

    // Tell content script to show loading near selection
    browser.tabs.sendMessage(tabId, {
      type: "CONTEXT_EXPLAIN",
      payload: { text },
    }).catch(() => {});

    // Fetch explanation asynchronously
    (async () => {
      try {
        const explanation = await explainSelection(text);
        await browser.tabs.sendMessage(tabId, {
          type: "CONTEXT_EXPLAIN_RESULT",
          payload: { text, explanation },
        }).catch(() => {});
      } catch (err) {
        await browser.tabs.sendMessage(tabId, {
          type: "CONTEXT_EXPLAIN_RESULT",
          payload: { text, explanation: "Could not generate explanation." },
        }).catch(() => {});
      }
    })();
  }
  if (info.menuItemId === "mindease-tts") {
    const text = info.selectionText?.trim();
    if (!text) return;
    browser.tabs.sendMessage(tabId, {
      type: "CONTEXT_TTS",
      payload: { text },
    }).catch(() => {});
  }


  if (info.menuItemId === "mindease-capture") {
    const windowId = tab?.windowId;
    (async () => {
      try {
        const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
        await browser.tabs.sendMessage(tabId, {
          type: "CONTEXT_CAPTURE_RESULT",
          payload: { dataUrl },
        }).catch(() => {});
      } catch (err) {
        console.warn("[Background] Capture error:", err);
      }
    })();
  }

  if (info.menuItemId === "mindease-ocr") {
    const imageUrl = info.srcUrl;
    if (!imageUrl) return;
    (async () => {
      try {
        const text = await ocrImageUrl(imageUrl);
        await browser.tabs.sendMessage(tabId, {
          type: "OCR_RESULT",
          payload: { imageUrl, text },
        }).catch(() => {});
      } catch (err) {
        await browser.tabs.sendMessage(tabId, {
          type: "OCR_RESULT",
          payload: { imageUrl, error: String(err) },
        }).catch(() => {});
      }
    })();
  }
});

/* ── Session lifecycle ───────────────────────────────────────────────────────── */

browser.runtime.onInstalled.addListener((details) => {
  console.log("[MindEase] Extension installed - background worker ready.", details.reason);
  setupContextMenus();


});

/* ── Initialize Layer 2 ─────────────────────────────────────────────────────── */
setupLayer2Listeners();

/* ── Tab close → notify SessionManager ──────────────────────────────────────── */
browser.tabs.onRemoved.addListener(async (tabId) => {
  await sessionReady;
  await sessionManager.removeTab(tabId).catch(err => {
    console.warn("[Background] Closing study tab failed:", err);
  });
});

/* ── Tab update & activation → record activity and register active learning tabs ── */
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("about:")) {
    await sessionReady;
    if (sessionManager.hasActiveSession()) {
      sessionManager.onActivity();
    }
  }
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  await sessionReady;
  if (sessionManager.hasActiveSession()) {
    sessionManager.onActivity();
  }
});

/* ── Message router ──────────────────────────────────────────────────────────── */

browser.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse({ received: false });
      return true;
    }
    const msg = message as ExtensionMessage;
    if (String(msg.type).startsWith("OFFSCREEN_")) return true;

    if (msg.type === "TRANSFORM_CONTENT") {
      if (!sender.tab?.url || isExcludedPage(sender.tab.url, sender.tab.incognito)) {
        sendResponse({ received: false, error: "Adaptation is unavailable on this page." });
        return true;
      }
      if (!isTransformRequest(msg.payload)) {
        sendResponse({ received: false, error: "Choose an adaptation before sending valid source content." });
        return true;
      }
      const { text, pageType, adaptation, language } = msg.payload;
      const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;

      if (!tabId) {
        sendResponse({ received: true });
        return true;
      }

      (async () => {
        await sessionReady;
        // Register tab in workspace if not already
        const sourceType = pageType === "lecture" ? "website" : pageType;
        const url = (sender as { tab?: { url?: string } } | undefined)?.tab?.url ?? "";
        const title = (sender as { tab?: { title?: string } } | undefined)?.tab?.title ?? "";
        await sessionManager.registerTab(tabId, url, sourceType as "pdf" | "video" | "website", title);
        sessionManager.onActivity();

        const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
        const stored = result[STORAGE_KEYS.PROFILE] as Record<string, unknown> | undefined;
        const fullProfile: FullCognitiveProfile = (stored?.transformationParams
          ? stored
          : DEFAULT_FULL_PROFILE) as FullCognitiveProfile;

        const userId = fullProfile.userId || "guest";
        const cognitiveProfile: CognitiveProfile = {
          userId,
          learningStyle: fullProfile.learningStyle,
          attentionSpan: fullProfile.attentionSpan,
          anchorNeed: fullProfile.anchorNeed,
          condition: fullProfile.condition,
          updatedAt: fullProfile.updatedAt,
        };
        startSession(userId, cognitiveProfile, sessionManager.getSessionId() ?? undefined);

        try {
          console.log("[Background] Starting transform for:", pageType);
          const wantsVisuals = adaptation === "visual";
          let visualCount = 0;
          let visualQueue = Promise.resolve();
          const completeSource = pageType === "pdf" ? await extractRemoteSource(url, "pdf") : text;
          const chunks = await transformContent(
            completeSource,
            pageType,
            {
              transformationParams: fullProfile.transformationParams,
              baseline: fullProfile.baseline,
              outputLanguage: language,
            },
            url,
            async (batch, append, done) => {
              await browser.tabs.sendMessage(tabId, {
                type: "TRANSFORMED_CONTENT",
                chunks: batch,
                baseline: fullProfile.baseline,
                transformationParams: fullProfile.transformationParams,
                condition: fullProfile.condition,
                language: language === "preferred" ? fullProfile.baseline.preferredLanguage : undefined,
                append,
                done,
              }).catch(() => {});
              if (wantsVisuals && visualCount < 5) {
                const candidates = batch.filter(chunk => chunk.visualPrompt || (chunk.sourceText ?? chunk.text).length > 200).slice(0, 5 - visualCount);
                visualCount += candidates.length;
                visualQueue = visualQueue.then(async () => {
                  if (!candidates.length) return;
                  try {
                    await generateVisualsFromChunks(candidates, fullProfile.transformationParams, true,
                      async visuals => { await browser.tabs.sendMessage(tabId, { type: "VISUALS_READY", visuals }).catch(() => {}); }, fullProfile.baseline);
                  } catch (error) {
                    await browser.tabs.sendMessage(tabId, { type: "VISUALS_READY", visuals: [], error: String(error) }).catch(() => {});
                  }
                });
              }
            },
          );
          console.log("[Background] Transform complete, chunks:", chunks.length);

          // Persist chunks for Layer 3 session assembly
          const chunkRes = await browser.storage.local.get(STORAGE_KEYS.SESSION_CHUNKS);
          const existingChunks = (chunkRes[STORAGE_KEYS.SESSION_CHUNKS] as ContentChunk[]) ?? [];
          const existingIds = new Set(existingChunks.map((c) => c.id));
          const uniqueNew = chunks.filter((c) => !existingIds.has(c.id));
          await browser.storage.local.set({
            [STORAGE_KEYS.SESSION_CHUNKS]: [...existingChunks, ...uniqueNew],
          });
        } catch (err) {
          console.warn("[Background] Transform error:", err);
          browser.tabs.sendMessage(tabId, { type: "TRANSFORM_ERROR", error: String(err) }).catch(() => {});
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
        const userId = String(payload?.userId ?? "guest");

        sessionReady.then(() => browser.storage.local.get(STORAGE_KEYS.PROFILE)).then((res) => {
          const stored = res[STORAGE_KEYS.PROFILE] as Record<string, unknown> | undefined;
          const profile: CognitiveProfile = (stored?.transformationParams
            ? stored
            : DEFAULT_FULL_PROFILE) as unknown as CognitiveProfile;
          startSession(userId, profile, sessionManager.getSessionId() ?? undefined);
        }).catch(() => {
          startSession(userId, DEFAULT_FULL_PROFILE as unknown as CognitiveProfile, sessionManager.getSessionId() ?? undefined);
        });

        // Register tab in workspace (creates workspace session if none exists)
        if (tabId) {
          (async () => {
            await sessionReady;
            await sessionManager.registerTab(tabId, url, sourceType === "lecture" ? "website" : sourceType, title);
          })();
        }
        break;
      }

      case "SESSION_END": {
        console.log("[Background] Session ended via user action.");
        sessionReady.then(() => sessionManager.endSession()).catch((err) => {
          console.warn("[Background] Session end failed:", err);
        });
        break;
      }

      case "COGNITIVE_EVENT": {
        const event = msg.payload as CognitiveEvent;
        sessionManager.onActivity();
        recordEvent(event);
        break;
      }

      case "HIGHLIGHT_NOTE": {
        const notePayload = msg.payload as {
          text: string; url?: string; title?: string; tabId?: number; sectionId?: string;
        };
        const senderTab = (sender as { tab?: { id?: number; url?: string; title?: string } } | undefined)?.tab;
        const actualTabId = senderTab?.id ?? notePayload.tabId ?? 0;
        const url = notePayload.url ?? senderTab?.url ?? "";
        const title = notePayload.title ?? senderTab?.title ?? "";

        // Store in workspace (per-tab) using real tab ID
        sessionManager.recordHighlight(actualTabId, notePayload.text, notePayload.sectionId);

        // Store aggregated notes (async IIFE since listener is not async)
        (async () => {
          const note: HighlightNote = {
            id: uuidv4(),
            text: notePayload.text,
            sourceUrl: url,
            resourceTitle: title,
            timestamp: Date.now(),
            sectionId: notePayload.sectionId,
          };
          await saveAggregatedNote(note);

          // Broadcast update to popup/overlay
          browser.runtime.sendMessage({ type: "HIGHLIGHTS_UPDATED" }).catch(() => {});
        })();
        break;
      }

      case "HIGHLIGHTS_GET": {
        (async () => {
          const notes = await loadAggregatedNotes();
          sendResponse({ type: "HIGHLIGHTS_DATA", notes: notes.notes });
        })();
        return true;
      }

      case "ACTIVITY_PING": {
        sessionManager.onActivity();
        break;
      }

      case "ARTIFACT_READY":
        browser.action.setBadgeText({ text: "✓" });
        browser.action.setBadgeBackgroundColor({ color: "#7C3AED" });
        break;

      case "RELATED_RESOURCES": {
        const { topics, preference, sourceUrl } = msg.payload as {
          topics?: unknown; preference?: unknown; sourceUrl?: unknown;
        };
        void findRelatedResources(
          Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string").slice(0, 3) : [],
          preference === "visual" ? "visual" : "text",
          typeof sourceUrl === "string" ? sourceUrl : "",
        ).then(resources => sendResponse({ resources })).catch(() => sendResponse({ resources: [] }));
        return true;
      }

      case "CLASSIFY_CONTENT": {
        const { title, snippet } = msg.payload as { title: string; snippet: string };
        const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (!tabId) break;
        (async () => {
          try {
            const classification = await classifyContent(title, snippet);
            await browser.tabs.sendMessage(tabId, {
              type: "CLASSIFY_CONTENT_RESULT",
              payload: { classification },
            }).catch(() => {});
          } catch (err) {
            console.warn("[Background] Classification error, defaulting to non-educational:", err);
            await browser.tabs.sendMessage(tabId, {
              type: "CLASSIFY_CONTENT_RESULT",
              payload: { classification: "entertainment" },
            }).catch(() => {});
          }
        })();
        break;
      }

      case "GENERATE_VISUALS": {
        const payload = msg.payload as { concepts?: string[]; chunks?: ContentChunk[] };
        (async () => {
          try {
            const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
            const stored = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
            const params = stored?.transformationParams ?? DEFAULT_FULL_PROFILE.transformationParams;
            let visuals: VisualEntry[] | undefined;
            if (payload.chunks?.length) {
              visuals = await generateVisualsFromChunks(payload.chunks, params, true);
            } else if (payload.concepts?.length) {
              visuals = await generateVisualsForConcepts(payload.concepts, params, true);
            }
            sendResponse({ type: "VISUALS_READY", visuals: visuals ?? [] });
          } catch (err) {
            console.warn("[Background] GENERATE_VISUALS error:", err);
            sendResponse({ type: "VISUALS_READY", visuals: [] });
          }
        })();
        return true;
      }

      case "OCR_IMAGE": {
        const payload = msg.payload as { imageUrl?: string; base64Image?: string };
        const srcTabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (!srcTabId || (!payload.imageUrl && !payload.base64Image)) break;
        (async () => {
          try {
            const text = payload.base64Image
              ? await ocrImageBase64(payload.base64Image)
              : await ocrImageUrl(payload.imageUrl!);
            await browser.tabs.sendMessage(srcTabId, {
              type: "OCR_RESULT",
              payload: { imageUrl: payload.imageUrl ?? "", text },
            }).catch(() => {});
          } catch (err) {
            await browser.tabs.sendMessage(srcTabId, {
              type: "OCR_RESULT",
              payload: { imageUrl: payload.imageUrl ?? "", error: String(err) },
            }).catch(() => {});
          }
        })();
        break;
      }

      case "EXPLAIN_SELECTION": {
        const text = msg.payload as string;
        const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (!tabId) break;
        (async () => {
          try {
            const explanation = await explainSelection(text);
            await browser.tabs.sendMessage(tabId, {
              type: "EXPLAIN_SELECTION_RESULT",
              payload: { text, explanation },
            }).catch(() => {});
          } catch (err) {
            console.warn("[Background] Explain error:", err);
            await browser.tabs.sendMessage(tabId, {
              type: "EXPLAIN_SELECTION_RESULT",
              payload: { text, explanation: "Could not generate explanation." },
            }).catch(() => {});
          }
        })();
        break;
      }

      case "TTS_SPEAK": {
        const { text } = msg.payload as { text: string };
        const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (tabId) {
          browser.tabs.sendMessage(tabId, { type: "TTS_SPEAK", payload: { text } }).catch(() => {});
        }
        break;
      }

      case "TTS_STOP": {
        const stopTabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (stopTabId) {
          browser.tabs.sendMessage(stopTabId, { type: "TTS_STOP", payload: {} }).catch(() => {});
        }
        break;
      }

      case "PREMIUM_SPEECH": {
        const payload = msg.payload as { text?: string; language?: string };
        const text = typeof payload?.text === "string" ? payload.text : "";
        if (!text.trim()) {
          sendResponse({ error: "Premium speech: empty text" });
          break;
        }
        (async () => {
          try {
            const [{ getApiKey }, { getSession }] = await Promise.all([
              import("@/utils/apiKeyManager"),
              import("@/utils/supabase"),
            ]);
            const baseUrl = (await getApiKey("premiumServer") || "http://localhost:8000").replace(/\/+$/, "");
            const session = await getSession();
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
              ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
            };
            const res = await fetch(`${baseUrl}/api/speech`, {
              method: "POST",
              headers,
              body: JSON.stringify({ text, language: payload.language }),
            });
            if (!res.ok) {
              const detail = await res.text().catch(() => res.statusText);
              throw new Error(`Premium speech is unavailable (${res.status}): ${detail.slice(0, 200)}`);
            }
            const blob = await res.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              binary += String.fromCharCode(...chunk);
            }
            const audioBase64 = btoa(binary);
            sendResponse({ audioBase64, contentType: blob.type || "audio/mpeg" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn("[Background] PREMIUM_SPEECH failed:", message);
            sendResponse({ error: message });
          }
        })();
        return true;
      }

      case "PLAY_TTS_AUDIO": {
        const payload = msg.payload as { audioBase64?: string; contentType?: string; volume?: number; rate?: number };
        (async () => {
          try {
            if (typeof document !== "undefined") {
              const { playAudioBlobDom } = await import("@/utils/ttsManager");
              const binary = atob(payload.audioBase64 ?? "");
              const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
              await playAudioBlobDom(new Blob([bytes], { type: "audio/mpeg" }), payload.volume ?? 1, payload.rate ?? 1);
              sendResponse({ success: true });
              return;
            }
            const ok = await ensureOffscreenDocument();
            if (!ok) {
              sendResponse({ error: "Offscreen not supported, fallback to DOM" });
              return;
            }
            const chromeRuntime = (globalThis as unknown as { chrome?: any }).chrome?.runtime;
            if (!chromeRuntime) {
              sendResponse({ error: "chrome.runtime unavailable" });
              return;
            }
            // Forward to offscreen document
            const resp = await chromeRuntime.sendMessage({
              type: "OFFSCREEN_PLAY",
              payload: {
                audioBase64: payload.audioBase64,
                contentType: payload.contentType || "audio/mpeg",
                volume: payload.volume ?? 1.0,
                rate: payload.rate ?? 1.0,
              },
            });
            const result = resp as { success?: boolean; error?: string } | undefined;
            if (result?.error) sendResponse({ error: result.error });
            else sendResponse({ success: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn("[Background] PLAY_TTS_AUDIO failed:", message);
            sendResponse({ error: message });
          }
        })();
        return true;
      }

      case "STOP_TTS_AUDIO":
      case "PAUSE_TTS_AUDIO":
      case "RESUME_TTS_AUDIO": {
        const offscreenType =
          msg.type === "STOP_TTS_AUDIO" ? "OFFSCREEN_STOP" :
          msg.type === "PAUSE_TTS_AUDIO" ? "OFFSCREEN_PAUSE" : "OFFSCREEN_RESUME";
        (async () => {
          try {
            if (typeof document !== "undefined") {
              const playback = await import("@/utils/ttsManager");
              if (msg.type === "STOP_TTS_AUDIO") playback.stop();
              else if (msg.type === "PAUSE_TTS_AUDIO") playback.pause();
              else playback.resume();
              sendResponse({ success: true });
              return;
            }
            const offscreenApi = (globalThis as unknown as { chrome?: any }).chrome?.offscreen;
            if (!offscreenApi || !(await offscreenApi.hasDocument())) {
              sendResponse({ success: true });
              return;
            }
            const chromeRuntime = (globalThis as unknown as { chrome?: any }).chrome?.runtime;
            if (!chromeRuntime) { sendResponse({ success: true }); return; }
            await chromeRuntime.sendMessage({ type: offscreenType });
            sendResponse({ success: true });
          } catch (err) {
            // Offscreen may not be ready — not fatal for stop/pause
            sendResponse({ success: true });
          }
        })();
        return true;
      }

      default:
        break;
    }

    sendResponse({ received: true });
    return true;
  }
);
