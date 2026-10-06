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
import { classifyContent, explainSelection, batchClassifyTabTitles } from "@/layer1/llmClient";
import { findRelatedResources } from "@/layer1/resourceRecommendations";
import { generateVisualsFromChunks } from "@/layer1/visualOrchestrator";
import { getTabTrackingState, updateTabCategoryGuarded, classifyTabByMetadata, pruneExcludedTabs, mapConcurrent } from "@/utils/tabTracking";
import { isPdfUrl } from "@/content/sourceHelpers";
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

  // Save session history entry for the dashboard (do not swallow durable archive failure)
  const result = await browser.storage.local.get("latestArtifact");
  const artifact = result.latestArtifact as Record<string, unknown> | undefined;
  const expectedSessionId = sessionManager.getSessionId();
  if (!artifact?.sessionId || artifact.sessionId !== expectedSessionId) {
    throw new Error(`No matching artifact generated for session ${expectedSessionId}`);
  }
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

/* ── Tab update & activation → register every tab; gate activity on inclusion ── */
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    await sessionReady;
    if (sessionManager.hasActiveSession()) {
      // Always register tab regardless of classification
      await recordOpenBrowserTab(tabId, tab.url, tab.title || "");
      void classifyOpenTabs();
      // Only record activity for included tabs
      if (tab.active) {
        const tracking = await getTabTrackingState(tabId);
        if (tracking.included) {
          sessionManager.onActivity();
        }
      }
    }
  }
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  await sessionReady;
  if (sessionManager.hasActiveSession()) {
    const tracking = await getTabTrackingState(activeInfo.tabId);
    if (tracking.included) {
      sessionManager.onActivity();
    }
  }
});

/* ── Scan and register existing browser tabs into workspace on start ── */
async function recordOpenBrowserTab(tabId: number, url?: string, title?: string): Promise<void> {
  const safeUrl = url || "";
  const safeTitle = title || safeUrl || "Tab";
  const sourceType = isPdfUrl(safeUrl) ? "pdf" : "website";
  await sessionManager.registerTab(tabId, safeUrl, sourceType, safeTitle, undefined, false);
}

let classificationRun: Promise<void> | undefined;
let classificationRequested = false;
function classifyOpenTabs(): Promise<void> {
  classificationRequested = true;
  if (classificationRun) return classificationRun;
  classificationRun = (async () => {
    await sessionReady;
    while (classificationRequested) {
      classificationRequested = false;
      if (!sessionManager.hasActiveSession()) return;
      const sessionId = sessionManager.getSessionId();
      const tabs = await browser.tabs.query({});
      const safeTabs = tabs.filter(tab => tab.id !== undefined && tab.url && !isExcludedPage(tab.url, tab.incognito));
      // Collect tabs that lack a category and batch-classify their titles through DeepSeek
      const unclassified = safeTabs.filter(tab => {
        const current = sessionManager.getTabs().find(item => item.tabId === tab.id && item.url === tab.url);
        return !current?.category;
      }).map(tab => ({ tabId: tab.id!, title: tab.title || tab.url!, url: tab.url! }));

      if (unclassified.length > 0) {
        const classifications = await batchClassifyTabTitles(unclassified);
        for (const [tabId, category] of classifications.entries()) {
          const tab = safeTabs.find(t => t.id === tabId);
          if (tab?.url && sessionManager.hasActiveSession() && sessionManager.getSessionId() === sessionId) {
            const current = sessionManager.getTabs().find(item => item.tabId === tabId && item.url === tab.url);
            if (!current?.category) {
              const updated = await updateTabCategoryGuarded(tabId, tab.url, category, sessionManager, sessionId);
              if (updated) {
                await browser.tabs.sendMessage(tabId, { type: "EXTENSION_STATE_CHANGED", active: true }).catch(() => {});
              }
            }
          }
        }
      }
    }
  })().catch(error => console.warn("[Background] Tab classification failed:", error))
    .finally(() => { classificationRun = undefined; });
  return classificationRun;
}

async function broadcastExtensionState(active: boolean): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map(tab => tab.id
    ? browser.tabs.sendMessage(tab.id, { type: "EXTENSION_STATE_CHANGED", active }).catch(() => {})
    : Promise.resolve()));
}

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
      const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
      if (!isTransformRequest(msg.payload)) {
        sendResponse({ received: false, error: "Choose an adaptation before sending valid source content." });
        return true;
      }
      const { text, pageType, adaptation, language } = msg.payload;

      if (!tabId) {
        sendResponse({ received: true });
        return true;
      }
      let accepted = false;
      (async () => {
        try {
          await sessionReady;
          const url = sender.tab!.url!;
          const context = await navigator.locks.request("mindease-session-lifecycle", async () => {
            const tracking = await getTabTrackingState(tabId);
            if (!tracking.active || !tracking.included || !sessionManager.hasActiveSession()) return null;
            const sessionId = sessionManager.getSessionId()!;
            await sessionManager.registerTab(tabId, url, pageType === "lecture" ? "website" : pageType, sender.tab?.title ?? "", undefined, true);
            const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
            const stored = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
            const fullProfile: FullCognitiveProfile = stored?.transformationParams ? stored : DEFAULT_FULL_PROFILE;
            await startSession(fullProfile.userId || "guest", fullProfile, sessionId);
            return { fullProfile, sessionId };
          });
          if (!context) {
            sendResponse({ received: false, error: "This tab is not included in the active session." });
            return;
          }
          const { fullProfile, sessionId } = context;
          accepted = true;
          sendResponse({ received: true });
          const wantsVisuals = adaptation === "visual";
          let visualCount = 0;
          let visualQueue = Promise.resolve();
          let completeSource = text;
          if (pageType === "pdf") {
            if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
              throw new Error("Local file or non-HTTP PDFs are not supported for remote extraction. Please use a remote HTTP or HTTPS PDF URL.");
            }
            completeSource = await extractRemoteSource(url, "pdf");
          }
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
              await navigator.locks.request("mindease-session-lifecycle", async () => {
                const tracking = await getTabTrackingState(tabId);
                const currentTab = await browser.tabs.get(tabId);
                if (!tracking.included || sessionManager.getSessionId() !== sessionId || currentTab.url !== url) {
                  throw new Error("The source tab or study session changed; adaptation stopped.");
                }
                const saved = await browser.storage.local.get(STORAGE_KEYS.SESSION_CHUNKS);
                const chunksById = new Map(((saved[STORAGE_KEYS.SESSION_CHUNKS] as ContentChunk[]) ?? []).map(chunk => [chunk.id, chunk]));
                for (const chunk of batch) chunksById.set(chunk.id, chunk);
                await browser.storage.local.set({ [STORAGE_KEYS.SESSION_CHUNKS]: [...chunksById.values()] });
              });
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
                  const candidateBlockIds = candidates.map(c => c.id);
                  // Add pendingBlockIds before auto visual generate
                  await browser.tabs.sendMessage(tabId, {
                    type: "VISUALS_READY",
                    visuals: [],
                    pendingBlockIds: candidateBlockIds,
                  }).catch(() => {});
                  try {
                    await generateVisualsFromChunks(candidates, fullProfile.transformationParams, true,
                      async visuals => { await browser.tabs.sendMessage(tabId, { type: "VISUALS_READY", visuals }).catch(() => {}); }, fullProfile.baseline, sessionId);
                  } catch (error) {
                    await browser.tabs.sendMessage(tabId, { type: "VISUALS_READY", visuals: [], error: String(error) }).catch(() => {});
                  } finally {
                    // and completedBlockIds after all in finally using VISUALS_READY
                    await browser.tabs.sendMessage(tabId, {
                      type: "VISUALS_READY",
                      visuals: [],
                      completedBlockIds: candidateBlockIds,
                    }).catch(() => {});
                  }
                });
              }
            },
          );
          console.log("[Background] Transform complete, chunks:", chunks.length);

        } catch (err) {
          if (!accepted) sendResponse({ received: false, error: String(err) });
          console.warn("[Background] Transform error:", err);
          browser.tabs.sendMessage(tabId, { type: "TRANSFORM_ERROR", error: String(err) }).catch(() => {});
        }
      })();

      return true;
    }

    switch (msg.type) {
      case "PING":
        sendResponse({ pong: true });
        break;

      case "SESSION_STATE_CHANGED": {
        const payload = msg.payload as { active?: boolean; includeCurrentTab?: boolean };
        (async () => {
          try {
            let activeSessionId: string | undefined;
            if (payload?.active) {
              await sessionReady;
              const wsRes = await browser.storage.local.get(STORAGE_KEYS.WORKSPACE);
              const existingWs = wsRes[STORAGE_KEYS.WORKSPACE] as Record<string, unknown> | undefined;
              if (existingWs?.archivePending) {
                sendResponse({ received: false, error: "Retry ending the previous session before starting another." });
                return;
              }

              await navigator.locks.request("mindease-session-lifecycle", async () => {
                const isNewSession = !sessionManager.hasActiveSession();
                if (isNewSession) {
                  const preservedOverrides = await pruneExcludedTabs();
                  await browser.storage.local.set({
                    [STORAGE_KEYS.SESSION_CHUNKS]: [],
                    [STORAGE_KEYS.NOTES]: null,
                    [STORAGE_KEYS.EXCLUDED_TABS]: preservedOverrides,
                  });
                }
                await browser.storage.local.set({ [STORAGE_KEYS.EXTENSION_ACTIVE]: true });

                const res = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
                const stored = res[STORAGE_KEYS.PROFILE] as Record<string, unknown> | undefined;
                const profile: CognitiveProfile = (stored?.transformationParams
                  ? stored
                  : DEFAULT_FULL_PROFILE) as unknown as CognitiveProfile;
                const userId = profile.userId || "guest";

                const sess = sessionManager.startWorkspace(userId);
                activeSessionId = sess.sessionId;
                if (!isNewSession) {
                  sessionManager.onActivity();
                }
                await startSession(userId, profile, sess.sessionId);

                const allTabs = await browser.tabs.query({});
                for (const t of allTabs) {
                  if (t.id) {
                    await recordOpenBrowserTab(t.id, t.url, t.title);
                  }
                }

                const senderTabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
                if (senderTabId && payload.includeCurrentTab) {
                  const excRes = await browser.storage.local.get(STORAGE_KEYS.EXCLUDED_TABS);
                  const currentExc = { ...((excRes[STORAGE_KEYS.EXCLUDED_TABS] as Record<number, boolean> | undefined) || {}) };
                  currentExc[senderTabId] = false;
                  await browser.storage.local.set({ [STORAGE_KEYS.EXCLUDED_TABS]: currentExc });
                }
              });

              // Outside the lock so child tabs handling EXTENSION_STATE_CHANGED can send SESSION_START without deadlocking
              await broadcastExtensionState(true);
              void classifyOpenTabs();
              sendResponse({ received: true, sessionId: activeSessionId });
            } else {
              await sessionReady;
              await navigator.locks.request("mindease-session-lifecycle", async () => {
                await sessionManager.endSession();
                await browser.storage.local.set({ [STORAGE_KEYS.EXTENSION_ACTIVE]: false });
              });
              await broadcastExtensionState(false);
              sendResponse({ received: true });
            }
          } catch (err) {
            console.warn("[Background] SESSION_STATE_CHANGED error:", err);
            sendResponse({ received: false, error: String(err) });
          }
        })();
        return true;
      }

      case "SESSION_START": {
        const payload = msg.payload as Record<string, unknown>;
        const tabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        const url = (sender as { tab?: { url?: string } } | undefined)?.tab?.url ?? String(payload?.url ?? "");
        const sourceType = (payload?.sourceType ?? "website") as "pdf" | "video" | "website" | "lecture";
        const title = String(payload?.title ?? (sender as { tab?: { title?: string } } | undefined)?.tab?.title ?? "");

        (async () => {
          try {
            await sessionReady;
            const tracking = tabId ? await getTabTrackingState(tabId) : null;
            console.log(`[Background] SESSION_START tabId=${tabId} hasActive=${sessionManager.hasActiveSession()} tracking=`, JSON.stringify(tracking));
            if (!tabId || !sessionManager.hasActiveSession()) {
              sendResponse({ received: false, error: "Session is not active." });
              return;
            }
            if (tracking && !tracking.included) {
              sendResponse({ received: false, error: "Tab is excluded from the active session." });
              return;
            }
            await sessionManager.registerTab(tabId, url, sourceType === "lecture" ? "website" : sourceType, title, undefined, true);
            sendResponse({ received: true, sessionId: sessionManager.getSessionId() });
          } catch (err) {
            sendResponse({ received: false, error: String(err) });
          }
        })();
        return true;
      }

      case "SESSION_END": {
        console.log("[Background] Session ended via user action.");
        const runEnd = async () => {
          await sessionReady;
          await sessionManager.endSession();
          await browser.storage.local.set({ [STORAGE_KEYS.EXTENSION_ACTIVE]: false });
          await broadcastExtensionState(false);
          sendResponse({ received: true });
        };
        (async () => {
          try {
            await navigator.locks.request("mindease-session-lifecycle", runEnd);
          } catch (err) {
            console.warn("[Background] Session end failed:", err);
            sendResponse({ received: false, error: String(err) });
          }
        })();
        return true;
      }

      case "GET_TAB_TRACKING_STATE": {
        const senderTabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (!senderTabId) {
          sendResponse({ active: false, included: false, overridden: false });
          return true;
        }
        (async () => {
          const state = await getTabTrackingState(senderTabId);
          sendResponse(state);
        })();
        return true;
      }

      case "COGNITIVE_EVENT": {
        const event = msg.payload as CognitiveEvent;
        const senderTabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (senderTabId) {
          (async () => {
            const tracking = await getTabTrackingState(senderTabId);
            if (!tracking.active || !tracking.included) return;
            sessionManager.onActivity();
            recordEvent(event);
          })();
        } else {
          sessionManager.onActivity();
          recordEvent(event);
        }
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
        const pingTabId = (sender as { tab?: { id?: number } } | undefined)?.tab?.id;
        if (pingTabId) {
          void getTabTrackingState(pingTabId).then(tracking => {
            if (tracking.active && tracking.included) {
              sessionManager.onActivity();
            }
          });
        } else {
          sessionManager.onActivity();
        }
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
        const senderTab = (sender as { tab?: { id?: number; url?: string } } | undefined)?.tab;
        const tabId = senderTab?.id;
        const capturedUrl = senderTab?.url;
        if (!tabId || !capturedUrl || isExcludedPage(capturedUrl)) {
          sendResponse({ classification: "unknown" });
          return true;
        }
        const payload = msg.payload as { title?: unknown; snippet?: unknown };
        const titleStr = typeof payload?.title === "string" ? payload.title.slice(0, 500) : "";
        const snippetStr = typeof payload?.snippet === "string" ? payload.snippet.slice(0, 2000) : "";
        const capturedSessionId = sessionManager.getSessionId();

        (async () => {
          try {
            const classification = await classifyContent(titleStr, snippetStr);
            const category = classification === "educational" ? "learning" : "distraction";
            const updated = await updateTabCategoryGuarded(
              tabId,
              capturedUrl,
              category,
              sessionManager,
              capturedSessionId,
            );
            if (!updated) {
              sendResponse({ classification: "unknown" });
              return;
            }
            sendResponse({ classification });
          } catch (err) {
            console.warn("[Background] Classification error:", err);
            sendResponse({ classification: "unknown" });
          }
        })();
        return true;
      }

      case "CLASSIFY_TABS": {
        sendResponse({ received: true });
        void classifyOpenTabs();
        return true;
      }

      case "SAVE_READER_CHUNKS": {
        const senderUrl = (sender as { url?: string } | undefined)?.url || "";
        const dashboardPrefix = browser.runtime.getURL("src/session/dashboard/dashboard.html");
        if (!senderUrl.startsWith(dashboardPrefix)) {
          sendResponse({ received: false, error: "Only dashboard reader may save reader chunks." });
          return true;
        }
        const payload = msg.payload as {
          sourceTabId?: number;
          sourceUrl?: string;
          sessionId?: string;
          chunks?: ContentChunk[];
        };
        const { sourceTabId, sourceUrl, sessionId, chunks } = payload || {};
        if (!sourceTabId || !sourceUrl || !sessionId || !Array.isArray(chunks) || chunks.length === 0) {
          sendResponse({ received: false, error: "Invalid reader chunk payload." });
          return true;
        }
        void navigator.locks.request("mindease-session-lifecycle", async () => {
          try {
            if (!sessionManager.hasActiveSession() || sessionManager.getSessionId() !== sessionId) {
              sendResponse({ received: false, error: "Session is not active or session ID mismatch." });
              return;
            }
            const currentTab = await browser.tabs.get(sourceTabId).catch(() => null);
            if (!currentTab || currentTab.url !== sourceUrl) {
              sendResponse({ received: false, error: "Source tab URL mismatch or tab closed." });
              return;
            }
            const tracking = await getTabTrackingState(sourceTabId);
            if (!tracking.active || !tracking.included) {
              sendResponse({ received: false, error: "Source tab is not included in the active session." });
              return;
            }
            const saved = await browser.storage.local.get(STORAGE_KEYS.SESSION_CHUNKS);
            const existingList = (saved[STORAGE_KEYS.SESSION_CHUNKS] as ContentChunk[]) ?? [];
            const chunksById = new Map(existingList.map(chunk => [chunk.id, chunk]));
            for (const chunk of chunks) chunksById.set(chunk.id, chunk);
            await browser.storage.local.set({ [STORAGE_KEYS.SESSION_CHUNKS]: [...chunksById.values()] });
            await sessionManager.registerTab(
              sourceTabId,
              sourceUrl,
              "pdf",
              currentTab.title || sourceUrl,
              undefined,
              false,
            );
            sendResponse({ received: true });
          } catch (err) {
            sendResponse({ received: false, error: String(err) });
          }
        });
        return true;
      }

      case "GENERATE_VISUALS": {
        const payload = msg.payload as { chunks?: ContentChunk[]; sessionId?: string };
        (async () => {
          try {
            if (!payload.chunks || !Array.isArray(payload.chunks) || payload.chunks.length === 0) {
              sendResponse({ type: "VISUALS_READY", visuals: [], error: "No chunks provided for visual generation." });
              return;
            }
            const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
            const stored = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
            const params = stored?.transformationParams ?? DEFAULT_FULL_PROFILE.transformationParams;
            const visuals = await generateVisualsFromChunks(payload.chunks, params, true, undefined, undefined, payload.sessionId);
            sendResponse({ type: "VISUALS_READY", visuals: visuals ?? [] });
          } catch (err) {
            console.warn("[Background] GENERATE_VISUALS error:", err);
            sendResponse({ type: "VISUALS_READY", visuals: [], error: String(err) });
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
