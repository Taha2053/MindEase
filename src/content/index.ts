import katexStyles from "@/styles/formulas.css?url";
import { renderMarkdown } from "@/utils/markdown";
import { replaceSanitizedHtml } from "@/utils/safeHtml";
/* ============================================================
   content/index.ts - Content Script
   Runs inside every webpage the student visits.
   Detects content type, tracks behavioral signals for Layer 2,
   and activates the appropriate layer.
   ============================================================ */

import browser from "webextension-polyfill";
import type { ContentChunk, VisualEntry, BaselineProfile, TransformationParams, CognitiveNeed } from "@/types";
import {
  speak as ttsSpeak,
  pause as ttsPause,
  resume as ttsResume,
  stop as ttsStop,
  isSpeaking,
  isPaused,
  loadTtsSettings,
  saveTtsSettings,
  DEFAULT_TTS_SETTINGS,
} from "@/utils/ttsManager";
import { STORAGE_KEYS } from "@/types";
import { loadTheme, saveTheme, type Theme } from "@/utils/themeManager";
import { iconHTML } from "@/utils/icons";
import { renderLatex } from "@/utils/latex";
import katex from "katex";
import {
  saveSidebarState,
  loadSidebarState,
  injectReopenButton,
  removeReopenButton,
  ensureReopenStyles,
  type SidebarState,
} from "@/content/sidebarManager";
import { showDiscoveryPrompt } from "@/content/discoveryPrompt";
import { requestAdaptationChoice, dismissAdaptationChoice } from "@/content/adaptationPrompt";
import { extractReadingText } from "@/content/sourceExtraction";
import { isExcludedPage } from "@/utils/pagePrivacy";
import {
  isPdfUrl,
  classifySource,
  detectVideoPlatform,
  loadTextTrackTranscript,
  transcriptToText,
  isNativePdfViewer,
} from "@/content/sourceHelpers";
import {
  injectShadowStyle,
  removeShadowStyle,
  appendToShadow,
  shadowById,
  shadowQuery,
  shadowQueryAll,
  getMindeaseShadow,
} from "@/content/shadowHost";

interface ActivationResult {
  decision: boolean;
  ambiguous: boolean;
}

function shouldActivate(): ActivationResult {
  if (isExcludedPage(window.location.href, browser.extension.inIncognitoContext)
    || document.querySelector('input[type="password"], input[autocomplete="cc-number"]')) {
    return { decision: false, ambiguous: false };
  }
  const { hostname, href: url } = window.location;
  const title = document.title;

  const neverEducational = [
    "netflix.com", "twitch.tv", "discord.com", "whatsapp.com",
    "snapchat.com",
  ];
  if (neverEducational.some(d => hostname.includes(d))) return { decision: false, ambiguous: false };

  // Search engine result pages (check URL path, not just hostname)
  if (/google\.\w{2,4}\/search/.test(url) || /bing\.com\/search/.test(url) || /search\.yahoo\.com/.test(url) || /duckduckgo\.com\/\?q=/.test(url)) {
    return { decision: false, ambiguous: false };
  }

  if (isPdfUrl(url, document.contentType)) return { decision: true, ambiguous: false };
  // Fast-track known learning workspaces & documents
  if (hostname.includes("classroom.google.com") ||
      hostname.includes("docs.google.com") ||
      hostname.includes("drive.google.com") ||
      hostname.includes("notion.so") ||
      hostname.includes("canvas.") ||
      hostname.includes("blackboard.com") ||
      hostname.includes("moodle.") ||
      hostname.includes("wikipedia.org") ||
      hostname.includes("arxiv.org") ||
      hostname.includes("khanacademy.org") ||
      hostname.includes("coursera.org") ||
      hostname.includes("edx.org")) {
    return { decision: true, ambiguous: false };
  }

  const signals: boolean[] = [];

  const eduUrlPatterns = [
    /\/learn/, /\/course/, /\/tutorial/, /\/lecture/,
    /\/r\/learn/, /\/r\/science/, /\/r\/math/, /\/r\/cs/,
    /\/r\/programming/, /\/r\/MachineLearning/,
  ];
  if (eduUrlPatterns.some(p => p.test(url))) signals.push(true);

  const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute("content");
  if (ogType === "article") signals.push(true);
  if (ogType && ["video.other", "music.song", "video.episode"].includes(ogType)) signals.push(false);

  if (hostname.includes("youtube.com") && url.includes("/watch")) {
    const genre = document.querySelector('meta[itemprop="genre"]')?.getAttribute("content");
    if (genre && ["Education", "Science & Technology"].includes(genre)) signals.push(true);
    if (url.includes("/shorts/")) signals.push(false);
    const durationMeta = document.querySelector('meta[itemprop="duration"]')?.getAttribute("content");
    if (durationMeta) {
      const mins = parseInt(durationMeta.match(/(\d+)M/)?.[1] ?? "0");
      if (mins > 0 && mins < 3) signals.push(false);
    }
  }

  const lowerTitle = title.toLowerCase();
  const eduKeywords = [
    "lecture", "tutorial", "course", "lesson", "explained",
    "research", "paper", "documentation", "guide", "how to",
    "introduction", "understanding", "proof", "theorem",
    "analysis", "theory", "fundamentals", "algorithm",
    "mathematics", "physics", "chemistry", "biology",
    "programming", "coding", "learn", "crash course",
  ];
  const entKeywords = [
    "funny", "vlog", "gameplay", "reaction", "highlights",
    "compilation", "music video", "review", "unboxing",
    "prank", "challenge", "fail", "cute", "meme",
    "entertainment", "gaming", "live stream", "best of",
    "montage", "satisfying", "asmr",
  ];
  const eduScore = eduKeywords.filter(k => lowerTitle.includes(k)).length;
  const entScore = entKeywords.filter(k => lowerTitle.includes(k)).length;
  if (eduScore > entScore) signals.push(true);
  if (entScore > eduScore) signals.push(false);

  const hasArticle = !!document.querySelector("article, .article, [role='main'], main");
  const hasLongText = document.body?.innerText?.length > 2000;
  const hasHeadings = document.querySelectorAll("h1,h2,h3").length >= 2;
  const hasCode = !!document.querySelector("pre code, code, .code, .highlight, .code-block");
  const hasCitations = !!document.querySelector(
    "cite, .citation, .reference, [class*='ref'], .bibliography, .footnote",
  );
  if (hasArticle && hasLongText && hasHeadings) signals.push(true);
  if (hasCode) signals.push(true);
  if (hasCitations) signals.push(true);

  if (signals.length === 0) return { decision: false, ambiguous: false };
  const trueCount = signals.filter(Boolean).length;
  const falseCount = signals.length - trueCount;
  const diff = Math.abs(trueCount - falseCount);
  const ambiguous = signals.length >= 2 && diff <= 1;
  return { decision: trueCount >= signals.length / 2, ambiguous };
}

/* ─── Keepalive ping - wake service worker before heavy messages ──────────── */
async function wakeServiceWorker(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: "PING" });
  } catch {
    /* ignore - just waking the worker */
  }
}

/* ── Behavior Signal Tracking ────────────────────────────────────────────────── */

interface TrackedSection {
  id: string;
  top: number;
  bottom: number;
  visited: boolean;
  firstVisitTime: number;
  lastVisitTime: number;
  scrollPastCount: number;
}

let sections: TrackedSection[] = [];
let lastScrollY = 0;
let lastScrollTime = Date.now();
let pauseTimer: ReturnType<typeof setTimeout> | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
let scrollHistory: { y: number; time: number }[] = [];
const SCROLL_HISTORY_SIZE = 10;
const PAUSE_THRESHOLD_MS = 3000;
const SKIP_SPEED_THRESHOLD_PX_PER_MS = 1.5;

/* ─── Content type detection ─────────────────────────────────────────────────── */

function detectSourceType(): "pdf" | "website" | "video" | "lecture" | null {
  return classifySource(
    window.location.href,
    document.contentType,
    document.querySelector("video") !== null,
  );
}

/* ─── Activity ping ──────────────────────────────────────────────────────────── */
let activityPingTimer: ReturnType<typeof setTimeout> | null = null;

function sendActivityPing(): void {
  if (activityPingTimer) clearTimeout(activityPingTimer);
  activityPingTimer = setTimeout(() => {
    browser.runtime.sendMessage({ type: "ACTIVITY_PING" }).catch(() => {});
  }, 5000);
}

/* ─── Emit signal to background ─────────────────────────────────────────────── */

function emitSignal(signal: "highlight" | "pause" | "reRead" | "skip" | "tabSwitch", sectionId: string = "page"): void {
  browser.runtime.sendMessage({
    type: "BEHAVIOR_SIGNAL",
    signal,
    timestamp: new Date().toISOString(),
    context: {
      url: window.location.href,
      sectionId,
    },
  }).catch(() => {});
  sendActivityPing();
}

/* ─── Section tracking ──────────────────────────────────────────────────────── */

function computeSectionId(element: HTMLElement): string {
  if (element.id) return element.id;
  const classes = Array.from(element.classList).join(".");
  const tag = element.tagName.toLowerCase();
  const text = element.textContent?.trim().substring(0, 40).replace(/\s+/g, "_") ?? "unknown";
  return `${tag}.${classes}.${text}`;
}

function buildSections(): void {
  const contentSelectors = [
    "article", "section", "main", "p", "h1", "h2", "h3", "h4",
    "li", "blockquote", "pre", "div.content", "div.post-content",
    "[class*='content']", "[class*='article']",
  ];
  const elements = document.querySelectorAll<HTMLElement>(contentSelectors.join(","));

  sections = [];
  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    sections.push({
      id: computeSectionId(el),
      top: rect.top + window.scrollY,
      bottom: rect.bottom + window.scrollY,
      visited: false,
      firstVisitTime: 0,
      lastVisitTime: 0,
      scrollPastCount: 0,
    });
  });
}

function findCurrentSection(scrollY: number): TrackedSection | null {
  const viewportBottom = scrollY + window.innerHeight;
  let best: TrackedSection | null = null;
  let maxOverlap = 0;

  for (const s of sections) {
    const overlapTop = Math.max(s.top, scrollY);
    const overlapBottom = Math.min(s.bottom, viewportBottom);
    const overlap = Math.max(0, overlapBottom - overlapTop);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      best = s;
    }
  }

  return best;
}

/* ─── Scroll handling ───────────────────────────────────────────────────────── */

function handleScroll(): void {
  const now = Date.now();
  const currentScrollY = window.scrollY;

  scrollHistory.push({ y: currentScrollY, time: now });
  if (scrollHistory.length > SCROLL_HISTORY_SIZE) {
    scrollHistory.shift();
  }

  if (scrollHistory.length >= 2) {
    const oldest = scrollHistory[0];
    const elapsed = now - oldest.time;
    const distance = Math.abs(currentScrollY - oldest.y);
    const speed = distance / elapsed;

    if (speed > SKIP_SPEED_THRESHOLD_PX_PER_MS && elapsed < 1000) {
      const minY = Math.min(lastScrollY, currentScrollY);
      const maxY = Math.max(lastScrollY, currentScrollY);
      for (const s of sections) {
        if (
          s.top >= minY && s.bottom <= maxY &&
          s.visited && (now - s.lastVisitTime) < 2000
        ) {
          emitSignal("skip", s.id);
        }
      }
    }
  }

  if (currentScrollY < lastScrollY) {
    const section = findCurrentSection(currentScrollY);
    if (section && section.visited && (now - section.lastVisitTime) > 5000) {
      emitSignal("reRead", section.id);
    }
  }

  const currentSection = findCurrentSection(currentScrollY);
  if (currentSection) {
    if (!currentSection.visited) {
      currentSection.visited = true;
      currentSection.firstVisitTime = now;
    }
    currentSection.lastVisitTime = now;
  }

  if (pauseTimer) clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => {
    const section = findCurrentSection(window.scrollY);
    emitSignal("pause", section?.id ?? "page");
  }, PAUSE_THRESHOLD_MS);

  lastScrollY = currentScrollY;
  lastScrollTime = now;
}

/* ─── Text selection (highlight) ────────────────────────────────────────────── */

function handleTextSelection(): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const text = selection.toString().trim()
    .replace(/\[CHUNK\s*\d*\]/gi, "")
    .replace(/^---+$/gm, "")
    .replace(/\[\/?[A-Z]+\]/g, "")
    .replace(/\[CONCEPT:[^\]]+\]/g, "")
    .replace(/\[SUMMARY:[^\]]+\]/g, "")
    .replace(/\u2605\s*/g, "")
    .replace(/&#9734;\s*/g, "")
    .replace(/\s{3,}/g, "  ")
    .trim();
  if (text.length < 3) return;

  const range = selection.getRangeAt(0);
  let sectionId = "page";
  if (range.startContainer.parentElement) {
    sectionId = computeSectionId(
      range.startContainer.parentElement.closest("[class]") as HTMLElement ?? range.startContainer.parentElement as HTMLElement
    );
  }

  emitSignal("highlight", sectionId);

  browser.runtime.sendMessage({
    type: "HIGHLIGHT_NOTE",
    payload: {
      text,
      url: window.location.href,
      title: document.title,
      sectionId,
    },
  }).catch(() => {});
}

/* ─── Visibility change (tab switch) ────────────────────────────────────────── */

function handleVisibilityChange(): void {
  if (document.hidden) {
    emitSignal("tabSwitch", "page");
  }
}

/* ─── Throttled scroll handler ──────────────────────────────────────────────── */

function throttledScroll(): void {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(handleScroll, 150);
}

/* ─── Init / destroy behavior tracking ─────────────────────────────────────── */

let _mutationObserver: MutationObserver | null = null;

function initBehaviorTracking(): void {
  buildSections();

  window.addEventListener("scroll", throttledScroll, { passive: true });
  document.addEventListener("mouseup", handleTextSelection);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("click", sendActivityPing);
  document.addEventListener("keydown", sendActivityPing);

  _mutationObserver = new MutationObserver(() => {
    buildSections();
  });
  _mutationObserver.observe(document.body, { childList: true, subtree: true });
}

function destroyBehaviorTracking(): void {
  if (_mutationObserver) {
    _mutationObserver.disconnect();
    _mutationObserver = null;
  }
  window.removeEventListener("scroll", throttledScroll);
  document.removeEventListener("mouseup", handleTextSelection);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("click", sendActivityPing);
  document.removeEventListener("keydown", sendActivityPing);
}

/* ── Entry point ─────────────────────────────────────────────────────────────── */

let _theme: Theme = "dark";
let _extensionActive = false;
let _cleanupVideo: (() => void) | null = null;
let _cancelPausedVideo: (() => void) | null = null;
let _resourcesRefreshedOnDone = false;
let _adaptationFlow: Promise<boolean> | null = null;
let _activated = false;
let _classificationPromise: Promise<"educational" | "entertainment" | "unknown"> | null = null;
let _activationEpoch = 0;

const defaultBaseline: BaselineProfile = {
  formatPreference: "text",
  attentionSpan: "medium",
  readingPace: "moderate",
  needsConceptAnchor: false,
  secondLanguageLearner: false,
  infoDensity: "detailed",
  learningApproach: "theory-first",
};

const chunkParams: TransformationParams = {
  chunkSize: "medium",
  simplificationLevel: 2,
  captionSpeed: "normal",
  useVisualAnchors: false,
  summaryFrequency: "medium",
};

/**
 * Check if the extension is globally active (user started a session).
 */
async function isExtensionActive(): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.EXTENSION_ACTIVE);
    return result[STORAGE_KEYS.EXTENSION_ACTIVE] === true;
  } catch {
    return false;
  }
}

/**
 * React to extension state changes.
 */
async function onExtensionStateChange(active: boolean): Promise<void> {
  const epoch = ++_activationEpoch;
  const state = active
    ? await browser.runtime.sendMessage({ type: "GET_TAB_TRACKING_STATE" }).catch(() => null) as { active?: boolean; included?: boolean; overridden?: boolean } | null
    : null;
  if (epoch !== _activationEpoch) return;
  if (!active || !state?.active || (state.overridden && !state.included)) {
    _extensionActive = false;
    _activated = false;
    _classificationPromise = null;
    dismissAdaptationChoice();
    destroyBehaviorTracking();
    stopTTS();
    shadowById("mindease-overlay")?.remove();
    shadowById("mindease-pdf-loader")?.remove();
    removeReopenButton();
    _cleanupVideo?.();
    _cleanupVideo = null;
    _cancelPausedVideo?.();
    _cancelPausedVideo = null;
    return;
  }
  const classification = await requestClassification();
  if (epoch !== _activationEpoch) return;
  const isDistraction = classification === "entertainment";
  const included = state.overridden ? state.included : !isDistraction;
  _extensionActive = Boolean(included);
  const sourceType = detectSourceType();
  if (!sourceType) return;
  _activated = true;
  try {
    await activateForSession(sourceType);
  } catch (error) {
    _activated = false;
    showAdaptationStatus(`Could not start adaptation: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

/** Classification labels come from page content, never hostname guesses. */
function requestClassification(): Promise<"educational" | "entertainment" | "unknown"> {
  if (_classificationPromise) return _classificationPromise;
  _classificationPromise = browser.runtime.sendMessage({
    type: "CLASSIFY_CONTENT",
    payload: { title: document.title, snippet: extractReadingText().slice(0, 2000) },
  }).then(value => {
    const reply = value as { classification?: string } | undefined;
    if (reply?.classification === "educational" || reply?.classification === "entertainment") return reply.classification;
    _classificationPromise = null;
    return "unknown" as const;
  }).catch(() => { _classificationPromise = null; return "unknown" as const; });
  return _classificationPromise;
}

async function activateForSession(sourceType: string): Promise<void> {
  console.log(`[MindEase Content] Activating for ${sourceType}`);

  const reply = await browser.runtime.sendMessage({
    type: "SESSION_START",
    payload: { sourceType, url: window.location.href, timestamp: Date.now(), title: document.title },
  }) as { received?: boolean; error?: string } | undefined;
  console.log(`[MindEase Content] SESSION_START reply:`, JSON.stringify(reply));
  if (!reply?.received) throw new Error(reply?.error || "This tab is not included in the active session.");

  initBehaviorTracking();
  void triggerContentTransformation(sourceType).catch(error => {
    showAdaptationStatus(`Could not prepare the source: ${error instanceof Error ? error.message : String(error)}`, true);
  });

  const savedState = await loadSidebarState();
  if (savedState.visible) {
    return;
  }
  ensureReopenStyles();
  const btn = injectReopenButton(_theme);
  btn.addEventListener("click", async () => {
    removeReopenButton();
    await saveSidebarState({ visible: true });
    const text = extractReadingText();
    if (text.trim().length >= 50) {
      await requestAndSendTransformation(text, "website");
    }
  });
}

async function triggerContentTransformation(sourceType: string): Promise<void> {
  await wakeServiceWorker();
  if (!_extensionActive) return;
  if (sourceType === "video") {
    const video = document.querySelector("video") as HTMLVideoElement;
    if (!video) {
      showAdaptationStatus("MindEase could not find a video element on this page.", true);
      return;
    }
    const platform = detectVideoPlatform(window.location.href);
    const startVideo = async () => {
      if (platform === "youtube") {
        await initYouTubeMode();
      } else {
        await initGenericVideoMode(video, platform);
      }
    };
    if (!video.paused) {
      await startVideo();
    } else {
      _cancelPausedVideo?.();
      let playHandler: (() => void) | null = null;
      const cancelWait = () => {
        if (playHandler) {
          video.removeEventListener("play", playHandler);
          playHandler = null;
        }
        shadowById("mindease-adaptation-status")?.remove();
      };
      _cancelPausedVideo = cancelWait;
      showAdaptationStatus("MindEase is ready — press play on the video to start adaptation.", false);
      playHandler = () => {
        _cancelPausedVideo = null;
        shadowById("mindease-adaptation-status")?.remove();
        void startVideo();
      };
      video.addEventListener("play", playHandler, { once: true });
    }
  } else if (sourceType === "pdf") {
    await initPDFMode();
  } else {
    if (document.visibilityState === "visible") {
      initContentTransformation(sourceType);
    } else {
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVisible);
          if (_extensionActive) initContentTransformation(sourceType);
        }
      };
      document.addEventListener("visibilitychange", onVisible);
    }
  }
}

(async () => {
  if (isExcludedPage(window.location.href, browser.extension.inIncognitoContext)
    || document.querySelector('input[type="password"], input[autocomplete="cc-number"]')) return;
  _theme = await loadTheme();

  // Always listen for state changes — handles tabs opened during a session too
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type: string; active?: boolean };
    if (msg.type === "EXTENSION_STATE_CHANGED") {
      void onExtensionStateChange(msg.active ?? false);
    }
  });

  // If extension is not active, show discovery prompt on relevant pages
  _extensionActive = await isExtensionActive();
  if (!_extensionActive) {
    const activation = shouldActivate();
    if (!activation.decision) return;
    const sourceType = detectSourceType();
    if (!sourceType) return;
    setTimeout(() => {
      void showDiscoveryPrompt(_theme, () => {
        void (async () => {
          const response = await browser.runtime.sendMessage({ type: "SESSION_STATE_CHANGED", payload: { active: true, includeCurrentTab: true } }) as { received?: boolean; error?: string };
          if (!response?.received) throw new Error(response?.error || "Session could not start.");
          _extensionActive = true;
          _activated = true;
          await activateForSession(sourceType);
        })().catch(error => {
          _activated = false;
          showAdaptationStatus(`Session could not start: ${error instanceof Error ? error.message : String(error)}`, true);
        });
      });
    }, 1200);
    return;
  }

  await onExtensionStateChange(true);
})();

/* ─── Layer 1: Content Transformation ──────────────────────────────────────────── */

async function requestAndSendTransformation(
  text: string,
  pageType: "website" | "pdf" | "video" | "lecture",
): Promise<boolean> {
  if (_adaptationFlow) return _adaptationFlow;
  _adaptationFlow = performTransformationRequest(text, pageType).finally(() => {
    _adaptationFlow = null;
  });
  return _adaptationFlow;
}

async function performTransformationRequest(
  text: string,
  pageType: "website" | "pdf" | "video" | "lecture",
): Promise<boolean> {
  if (!_extensionActive) return false;
  if (isExcludedPage(window.location.href, browser.extension.inIncognitoContext)
    || document.querySelector('input[type="password"], input[autocomplete="cc-number"]')) return false;
  const stored = await browser.storage.local.get(STORAGE_KEYS.PROFILE).catch(() => ({}));
  const profile = (stored as Record<string, unknown>)[STORAGE_KEYS.PROFILE] as { baseline?: BaselineProfile } | undefined;
  const adaptation = await requestAdaptationChoice(_theme, profile?.baseline);
  if (!adaptation || !_extensionActive) return false;
  showAdaptationStatus("MindEase is preparing the first adapted section…", false);
  let response: { received?: boolean; error?: string } | null = null;
  try {
    response = await browser.runtime.sendMessage({
      type: "TRANSFORM_CONTENT",
      payload: { text, pageType, adaptation: adaptation.adaptation, language: adaptation.language },
    }) as { received?: boolean; error?: string } | null;
  } catch (error) {
    showAdaptationStatus(`MindEase background connection failed: ${error instanceof Error ? error.message : String(error)}. Reload the extension and refresh this tab.`, true);
    return false;
  }
  // Firefox may resolve callback-style background messages without carrying
  // the acknowledgement. Only an explicit rejection should stop the flow;
  // async provider failures arrive through TRANSFORM_ERROR.
  if (response?.received === false) {
    showAdaptationStatus(response?.error || "MindEase could not start this adaptation. Reload the extension and refresh this tab.", true);
    return false;
  }
  return true;
}

function showAdaptationStatus(message: string, error: boolean): void {
  let status = shadowById("mindease-adaptation-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "mindease-adaptation-status";
    status.setAttribute("role", error ? "alert" : "status");
    status.setAttribute("aria-live", "polite");
    Object.assign(status.style, {
      position: "fixed", right: "24px", bottom: "24px", zIndex: "2147483647",
      maxWidth: "360px", padding: "14px 16px", borderRadius: "12px",
      font: "600 14px/1.45 Inter, system-ui, sans-serif",
      boxShadow: "0 12px 36px rgba(0,0,0,.28)",
    });
    appendToShadow(status);
  }
  status.setAttribute("role", error ? "alert" : "status");
  status.style.background = _theme === "dark" ? "#171717" : "#d4d4d4";
  status.style.color = _theme === "dark" ? "#d4d4d4" : "#171717";
  status.style.border = `2px solid ${_theme === "dark" ? "#d4d4d4" : "#171717"}`;
  status.textContent = message;
  if (error) setTimeout(() => status?.remove(), 12_000);
}

function initContentTransformation(pageType: string): void {
  void (async () => {
    try {
      const text = extractReadingText();
      if (text.trim().length < 50) {
        showAdaptationStatus("MindEase could not find enough readable material on this page.", true);
        return;
      }
      await requestAndSendTransformation(text, pageType as "website" | "pdf" | "video" | "lecture");
    } catch (err) {
      console.error("[MindEase] Transform send error:", err);
      showAdaptationStatus(`MindEase could not open adaptation: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  })();
}

/* ── Helper: HTML escape ── */
function _escHtml(s: string): string {
  const d = document.createElement("div");
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}
function _trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\u2026";
}

/* ── Render notes into the notes list container ── */
function renderNotesList(notes?: Array<Record<string, unknown>>): void {
  const container = shadowById("mindease-notes-list");
  if (!container) return;
  if (!notes || notes.length === 0) {
    replaceSanitizedHtml(container, '<p style="color:var(--text-muted);font-size:0.78rem;text-align:center;padding:12px">Highlight text on the page to create notes.</p>');
    return;
  }
  const recent = notes.slice(-20).reverse();
  replaceSanitizedHtml(container, recent.map((n) => `
    <div class="mindease-note-card">
      <div class="mindease-note-text">\u201C${renderLatex(_escHtml(String(n.text ?? "")))}\u201D</div>
      <div class="mindease-note-meta">
        <span class="mindease-note-source">${_escHtml(_trunc(String(n.resourceTitle ?? n.sourceUrl ?? ""), 40))}</span>
        <span>${new Date(Number(n.timestamp ?? 0)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  `).join(""));
}

function fmtDurationLocal(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

/* Receive pushed response from background */
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as {
    type: string; chunks?: ContentChunk[]; error?: string; payload?: unknown;
    visuals?: VisualEntry[]; baseline?: BaselineProfile; transformationParams?: TransformationParams;
    condition?: CognitiveNeed; language?: string; append?: boolean; done?: boolean;
    pendingBlockIds?: string[]; completedBlockIds?: string[];
  };
  if (msg.type === "TRANSFORMED_CONTENT" && msg.chunks && msg.chunks.length > 0) {
    if (!_extensionActive) return;
    removeReopenButton();
    shadowById("mindease-adaptation-status")?.remove();
    if (!msg.append) _ttsBatchesDone = false;
    if (msg.append) {
      appendToOverlay(msg.chunks);
    } else {
      injectOverlay(msg.chunks, msg.baseline, msg.transformationParams, msg.condition, msg.language);
    }
    if (msg.done) {
      _ttsBatchesDone = true;
      const marker = shadowById("mindease-loading-marker");
      if (marker) (marker as HTMLElement).style.display = "none";
      if (!_resourcesRefreshedOnDone && _contentChunks.length > 0) {
        _resourcesRefreshedOnDone = true;
        const aggregateTopics = [...new Set(_contentChunks.flatMap(c => c.conceptTags).filter(Boolean))];
        if (aggregateTopics.length === 0) {
          const cleanDocTitle = document.title.replace(/\s*[-–|].*$/, "").trim();
          if (cleanDocTitle.length >= 3 && cleanDocTitle.length <= 60) {
            aggregateTopics.push(cleanDocTitle);
          }
        }
        void showRelatedResources(aggregateTopics, _formatPreference);
      }
    }
  }
  if (msg.type === "VISUALS_READY" && _extensionActive) {
    if (msg.pendingBlockIds) showVisualPlaceholders(msg.pendingBlockIds);
    if (msg.visuals?.length) renderVisuals(msg.visuals);
    if (msg.completedBlockIds) finishVisualPlaceholders(msg.completedBlockIds, msg.error);
    if (msg.error) showAdaptationStatus(`Visual generation failed: ${msg.error}`, true);
  }
  if (msg.type === "TRANSFORM_ERROR") {
    _ttsBatchesDone = true;
    console.error("[MindEase Content] Transform error:", msg.error);
    showAdaptationStatus(`Adaptation failed: ${msg.error || "The provider did not return valid grounded content."}`, true);
  }
  if (msg.type === "HIGHLIGHTS_UPDATED") {
    browser.storage.local.get("mindease_notes").then((updated) => {
      const data = updated.mindease_notes as { notes?: Array<Record<string, unknown>> } | undefined;
      renderNotesList(data?.notes);
    });
  }
  if (msg.type === "ARTIFACT_READY") {
    /* Store latest artifact for overlay to pick up */
    browser.storage.local.set({ latestArtifact: msg.payload });
  }
  if (msg.type === "EXPLAIN_SELECTION_RESULT") {
    const p = msg.payload as { text: string; explanation: string };
    const capturePopup = shadowById("mindease-capture-result");
    const capPlaceholder = capturePopup?.querySelector(".cap-ocr-text");
    if (capPlaceholder) {
      replaceSanitizedHtml(capPlaceholder, `<strong>Explanation:</strong><div style="margin:6px 0 0;line-height:1.6">${renderMarkdown(p.explanation)}</div>`);
    } else {
      const popup = shadowById("mindease-explain-popup");
      const body = shadowById("mindease-explain-body");
      const loader = shadowById("mindease-explain-loader");
      if (popup && body && loader) {
        loader.style.display = "none";
        body.textContent = p.explanation;
        body.style.display = "block";
      }
    }
    // Also forward to child full-view window if exists
    const fv = (window as unknown as Record<string, unknown>).___mindeaseFullView as Window | undefined;
    if (fv && !fv.closed) {
      try { fv.postMessage({ type: "EXPLAIN_SELECTION_RESULT", payload: p }, "*"); } catch {}
    }
  }

  if (msg.type === "CONTEXT_EXPLAIN") {
    const p = msg.payload as { text: string };
    showContextExplainLoading(p.text);
  }

  if (msg.type === "CONTEXT_EXPLAIN_RESULT") {
    const p = msg.payload as { text: string; explanation: string };
    showContextExplainResult(p.text, p.explanation);
  }

  if (msg.type === "CONTEXT_CAPTURE_RESULT") {
    const p = msg.payload as { dataUrl: string };
    showCaptureCropTool(p.dataUrl);
  }

  if (msg.type === "OCR_RESULT") {
    const p = msg.payload as { imageUrl: string; text?: string; error?: string };
    const capturePopup = shadowById("mindease-capture-result");
    if (capturePopup) {
      const placeholder = capturePopup.querySelector(".cap-ocr-placeholder");
      if (placeholder) {
        if (p.error) {
          placeholder.textContent = `OCR failed: ${p.error}`;
        } else {
          placeholder.className = "cap-ocr-text";
          replaceSanitizedHtml(placeholder, "<em>Explaining&hellip;</em>");
          browser.runtime.sendMessage({
            type: "EXPLAIN_SELECTION",
            payload: p.text,
          }).catch(() => {});
        }
      }
    } else {
      showOcrResult(p.text, p.error);
    }
  }

  if (msg.type === "CONTEXT_TTS") {
    const p = msg.payload as { text: string };
    if (p?.text && p.text.trim().length > 0) {
      const rect = getSelectionRect();
      showFloatingTtsPlayer(p.text, rect);
    }
  }

  if (msg.type === "TTS_SPEAK") {
    const { text } = msg.payload as { text: string };
    if (text && text.trim().length > 0) {
      const rect = getSelectionRect();
      showFloatingTtsPlayer(text, rect);
    }
  }

  if (msg.type === "TTS_STOP") {
    stopTTS();
    hideFloatingTtsPlayer();
  }
});

/* ── postMessage bridge for full-view window ── */
window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as { type?: string; payload?: unknown };
  if (data?.type === "EXPLAIN_SELECTION" && typeof data.payload === "string") {
    browser.runtime.sendMessage({ type: "EXPLAIN_SELECTION", payload: data.payload }).catch(() => {});
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════
   Overlay Styles - Injected CSS string with theme variables
   ═══════════════════════════════════════════════════════════════════════════════ */

const OVERLAY_CSS = `
      /* ── Theme variables (scoped to overlay) ── */
      #mindease-overlay[data-theme="dark"] {
        --bg-base:        #171717;
        --bg-surface:     color-mix(in srgb, #171717 92%, #d4d4d4);
        --bg-surface-alt: color-mix(in srgb, #171717 84%, #d4d4d4);
        --bg-elevated:    color-mix(in srgb, #171717 76%, #d4d4d4);
        --bg-overlay:     #171717;
        --border:         rgba(212, 212, 212, .20);
        --border-hover:   #d4d4d4;
        --border-focus:   #d4d4d4;
        --text-primary:   #d4d4d4;
        --text-dim:       rgba(212, 212, 212, .80);
        --text-muted:     rgba(212, 212, 212, .62);
        --accent:         #d4d4d4;
        --accent-secondary: #d4d4d4;
        --accent-gradient:  linear-gradient(135deg, #d4d4d4, #d4d4d4);
        --accent-glow:      rgba(247, 230, 202,0.25);
        --danger:         #d4d4d4;
        --success:        #d4d4d4;
        --warning:        #d4d4d4;
        --shadow:         -12px 0 36px rgba(0,0,0,0.28);
        --shadow-right:   12px 0 36px rgba(0,0,0,0.28);
        --font-family:    -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
      }

      #mindease-overlay[data-theme="light"] {
        --bg-base:        #d4d4d4;
        --bg-surface:     color-mix(in srgb, #d4d4d4 94%, #171717);
        --bg-surface-alt: color-mix(in srgb, #d4d4d4 86%, #171717);
        --bg-elevated:    color-mix(in srgb, #d4d4d4 78%, #171717);
        --bg-overlay:     #d4d4d4;
        --border:         rgba(23, 23, 23, .18);
        --border-hover:   #171717;
        --border-focus:   #171717;
        --text-primary:   #171717;
        --text-dim:       rgba(23, 23, 23, .76);
        --text-muted:     rgba(23, 23, 23, .60);
        --accent:         #171717;
        --accent-secondary: #171717;
        --accent-gradient:  linear-gradient(135deg, #171717, #171717);
        --accent-glow:      rgba(140,169,255,0.20);
        --danger:         #171717;
        --success:        #171717;
        --warning:        #171717;
        --shadow:         -12px 0 32px rgba(29,35,48,0.10);
        --shadow-right:   12px 0 32px rgba(29,35,48,0.10);
        --font-family:    -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
      }

      /* ── Base overlay ── */
      #mindease-overlay {
        all: initial;
        position: fixed;
        top: 0;
        right: 0;
        width: var(--overlay-width, min(520px, 92vw));
        height: var(--overlay-height, 100vh);
        max-height: 100vh;
        background: var(--bg-overlay);
        color: var(--text-primary);
        font-family: var(--font-family);
        font-size: 0.875rem;
        line-height: 1.65;
        z-index: 2147483647;
        box-shadow: var(--shadow);
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--border);
        overflow: hidden;
        animation: mindease-slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      #mindease-overlay *,
      #mindease-overlay *::before,
      #mindease-overlay *::after {
        box-sizing: border-box;
      }

      @keyframes mindease-slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }

      @keyframes mindease-fadeUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes mindease-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* ── Header ── */
      #mindease-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: var(--bg-surface);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      #mindease-logo {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #mindease-logo .logo-icon {
        width: 24px; height: 24px;
        background: var(--accent-gradient);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        flex-shrink: 0;
      }
      #mindease-logo .logo-text {
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--text-primary);
        letter-spacing: 0.03em;
      }
      #mindease-logo .logo-badge {
        display: none;
      }

      /* ── Controls ── */
      #mindease-controls {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .mindease-ctrl-btn {
        background: none;
        border: 1px solid transparent;
        color: var(--text-muted);
        width: 26px; height: 26px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .mindease-ctrl-btn:hover { color: var(--text-primary); background: var(--bg-elevated); border-color: var(--border); }
      .mindease-ctrl-btn:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
      }
      #mindease-close:hover { color: var(--danger); border-color: var(--danger); }

      /* ── Tabs ── */
      #mindease-tabs {
        display: flex;
        gap: 2px;
        padding: 6px 10px;
        background: var(--bg-surface);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .mindease-tab {
        flex: 1;
        padding: 6px 4px;
        font-size: 0.65rem;
        font-weight: 500;
        color: var(--text-muted);
        text-align: center;
        cursor: pointer;
        border-radius: 6px;
        transition: all 0.2s;
        letter-spacing: 0.02em;
        background: transparent;
        border: none;
        font-family: var(--font-family);
        position: relative;
      }
      .mindease-tab:hover { color: var(--text-dim); background: var(--bg-elevated); }
      .mindease-tab.active {
        color: var(--text-primary);
        background: var(--bg-elevated);
        font-weight: 600;
      }
      .mindease-tab.active::after {
        content: '';
        position: absolute;
        bottom: -6px;
        left: 30%;
        right: 30%;
        height: 2px;
        background: var(--accent);
        border-radius: 1px;
      }
      .mindease-tab:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }

      /* ── Stats bar ── */
      #mindease-stats-bar {
        display: flex;
        gap: 6px;
        padding: 8px 10px;
        background: var(--bg-surface);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .mindease-stat {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: color-mix(in srgb, var(--accent) 6%, var(--bg-surface-alt));
        border: 1px solid color-mix(in srgb, var(--accent) 12%, transparent);
        border-radius: 8px;
      }
      .mindease-stat .s-icon {
        width: 20px; height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        opacity: 0.7;
      }
      .mindease-stat .s-icon svg { width: 14px; height: 14px; }
      .mindease-stat .s-num {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--accent);
        line-height: 1;
      }
      .mindease-stat .s-label {
        font-size: 0.55rem;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        line-height: 1;
      }

      /* ── Body ── */
      #mindease-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        scroll-behavior: smooth;
      }
      #mindease-body::-webkit-scrollbar { width: 4px; }
      #mindease-body::-webkit-scrollbar-track { background: transparent; }
      #mindease-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
      #mindease-body::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }

      .mindease-tab-content { display: none; }
      .mindease-tab-content.active { display: block; }
      .mindease-tab-content:focus { outline: none; }

      /* ── Chunk cards ── */
      .mindease-chunk {
        position: relative;
        margin-bottom: 12px;
        padding: 14px;
        background: var(--bg-surface);
        border-radius: 10px;
        border: 1px solid var(--border);
        transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        animation: mindease-fadeUp 0.3s ease both;
      }
      .mindease-chunk:hover { border-color: var(--border-hover); }
      .mindease-chunk.has-concept {
        border-color: color-mix(in srgb, var(--accent) 20%, transparent);
        background: linear-gradient(135deg, var(--bg-surface), var(--bg-elevated));
      }
      .mindease-chunk.tts-active-chunk {
        border-color: var(--accent) !important;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent) !important;
        background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface)) !important;
      }
      .chunk-speak-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface));
        color: var(--accent);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0.65;
        transition: opacity 0.15s, background 0.15s, transform 0.15s;
        padding: 0;
        z-index: 2;
      }
      .mindease-chunk:hover .chunk-speak-btn {
        opacity: 1;
      }
      .chunk-speak-btn:hover {
        opacity: 1;
        background: var(--accent);
        color: var(--bg-base);
        transform: scale(1.06);
      }
      .chunk-speak-btn.speaking {
        opacity: 1;
        background: var(--accent);
        color: var(--bg-base);
      }
      .mindease-overlay-speed-btn.active {
        background: var(--accent) !important;
        color: var(--bg-base) !important;
        border-color: var(--accent) !important;
      }
      .chunk-concept-tag {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-bottom: 10px;
        padding: 4px 10px;
        border-radius: 6px;
      }

      .chunk-body {
        color: var(--text-primary);
        font-size: 0.855rem;
        line-height: 1.75;
      }
      .chunk-body p {
        margin: 0 0 8px;
      }
      .chunk-body p:last-child {
        margin-bottom: 0;
      }
      .chunk-body h4.chunk-subtitle {
        font-size: 0.88rem;
        font-weight: 700;
        margin: 12px 0 6px;
        padding-bottom: 4px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
      }
      .chunk-body ul {
        margin: 6px 0;
        padding-left: 18px;
        list-style: none;
      }
      .chunk-body ul li {
        position: relative;
        padding-left: 14px;
        margin-bottom: 4px;
      }
      .chunk-body ul li::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0.5em;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.5;
      }
      .chunk-body blockquote {
        margin: 8px 0;
        padding: 8px 12px;
        border-left: 3px solid;
        border-radius: 0 6px 6px 0;
        font-style: italic;
        font-size: 0.82rem;
        opacity: 0.9;
      }
      .chunk-body code {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 0.78rem;
        padding: 1px 5px;
        border-radius: 3px;
        background: color-mix(in srgb, currentColor 8%, transparent);
      }
      .chunk-body strong {
        font-weight: 700;
      }
      .adapted-label {
        display: inline-flex; align-items: center; gap: 5px; margin-bottom: 8px;
        color: var(--accent); font-size: 0.68rem; font-weight: 800;
        letter-spacing: 0.08em; text-transform: uppercase;
      }
      .source-disclosure { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 8px; }
      .source-disclosure summary { cursor: pointer; color: var(--text-muted); font-size: 0.72rem; font-weight: 700; }
      .source-disclosure-body { margin-top: 8px; color: var(--text-dim); font-size: 0.76rem; line-height: 1.55; }

      /* ── Chunk color variants ── */
      .mindease-chunk.color-accent {
        --chunk-theme: var(--accent);
        --chunk-bg: color-mix(in srgb, var(--accent) 6%, var(--bg-surface));
      }
      .mindease-chunk.color-secondary {
        --chunk-theme: var(--accent-secondary);
        --chunk-bg: color-mix(in srgb, var(--accent-secondary) 6%, var(--bg-surface));
      }
      .mindease-chunk.color-tertiary {
        --chunk-theme: var(--accent);
        --chunk-bg: color-mix(in srgb, var(--accent) 6%, var(--bg-surface));
      }
      .mindease-chunk.color-quaternary {
        --chunk-theme: var(--accent);
        --chunk-bg: color-mix(in srgb, var(--accent) 6%, var(--bg-surface));
      }
      .mindease-chunk.color-accent,
      .mindease-chunk.color-secondary,
      .mindease-chunk.color-tertiary,
      .mindease-chunk.color-quaternary {
        border-color: color-mix(in srgb, var(--chunk-theme) 20%, var(--border));
        background: var(--chunk-bg);
      }
      .mindease-chunk:hover.color-accent { border-color: color-mix(in srgb, var(--chunk-theme) 50%, var(--border-hover)); }
      .mindease-chunk:hover.color-secondary { border-color: color-mix(in srgb, var(--chunk-theme) 50%, var(--border-hover)); }
      .mindease-chunk:hover.color-tertiary { border-color: color-mix(in srgb, var(--chunk-theme) 50%, var(--border-hover)); }
      .mindease-chunk:hover.color-quaternary { border-color: color-mix(in srgb, var(--chunk-theme) 50%, var(--border-hover)); }

      .color-accent .chunk-concept-tag { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
      .color-secondary .chunk-concept-tag { color: var(--accent-secondary); background: color-mix(in srgb, var(--accent-secondary) 12%, transparent); }
      .color-tertiary .chunk-concept-tag,
      .color-quaternary .chunk-concept-tag { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }

      .color-accent .chunk-body h4.chunk-subtitle { color: var(--accent); }
      .color-secondary .chunk-body h4.chunk-subtitle { color: var(--accent-secondary); }
      .color-tertiary .chunk-body h4.chunk-subtitle,
      .color-quaternary .chunk-body h4.chunk-subtitle { color: var(--accent); }

      .color-accent .chunk-body blockquote { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
      .color-secondary .chunk-body blockquote { border-left-color: var(--accent-secondary); background: color-mix(in srgb, var(--accent-secondary) 6%, transparent); }
      .color-tertiary .chunk-body blockquote,
      .color-quaternary .chunk-body blockquote { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }

      .chunk-summary {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid var(--border);
        font-size: 0.8rem;
        color: var(--text-dim);
        display: flex;
        align-items: center;
        gap: 6px;
      }

      /* ── Visuals grid ── */
      .visuals-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
        padding: 4px 0;
      }
      .visual-card {
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        transition: border-color 0.2s;
      }
      .visual-card:hover { border-color: var(--accent); }
      .visual-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: color-mix(in srgb, var(--accent) 8%, transparent);
        border-bottom: 1px solid var(--border);
      }
      .visual-card-concept {
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--accent);
      }
      .visual-card-img {
        width: 100%;
        display: block;
        background: var(--bg-base);
        object-fit: contain;
        padding: 8px;
      }
      .visual-card-desc {
        padding: 8px 12px;
        font-size: 0.72rem;
        color: var(--text-dim);
        line-height: 1.55;
        border-top: 1px solid var(--border);
        background: var(--bg-surface-alt);
      }
      .visual-card-source {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .visual-card-source.napkin {
        background: color-mix(in srgb, #7C3AED 15%, transparent);
        color: #a78bfa;
      }
      .visuals-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        border-radius: 8px;
        font-size: 0.6rem;
        font-weight: 700;
        padding: 0 4px;
        background: var(--accent);
        color: #fff;
        margin-left: 4px;
      }
      .visuals-placeholder {
        color: var(--text-muted);
        font-size: 0.78rem;
        text-align: center;
        padding: 24px 12px;
      }

      .mindease-section-title {
        font-size: 0.65rem;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin: 16px 0 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mindease-section-title::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border);
      }

      /* ── Footer ── */
      #mindease-footer {
        padding: 12px 16px;
        background: var(--bg-surface-alt);
        border-top: 1px solid var(--border);
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }
      .mindease-btn {
        flex: 1;
        padding: 9px;
        border: none;
        border-radius: 8px;
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        letter-spacing: 0.02em;
        font-family: var(--font-family);
      }
      .mindease-btn:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
      }
      .mindease-btn-primary {
        background: var(--accent-gradient);
        color: var(--bg-base);
        font-weight: 600;
      }
      .mindease-btn-primary:hover { opacity: 0.9; }
      .mindease-btn-ghost {
        background: transparent;
        color: var(--text-dim);
        border: 1px solid var(--border);
      }
      .mindease-btn-ghost:hover { color: var(--text-primary); border-color: var(--border-hover); }

      /* ── Profile / Session panels ── */
      .profile-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }
      .profile-card {
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 10px;
      }
      .profile-card .pc-label {
        font-size: 0.6rem;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 4px;
      }
      .profile-card .pc-value {
        font-size: 0.82rem;
        font-weight: 500;
        color: var(--accent);
      }

      .rl-bar-container { margin-bottom: 8px; }
      .rl-bar-label {
        display: flex;
        justify-content: space-between;
        font-size: 0.72rem;
        color: var(--text-dim);
        margin-bottom: 4px;
      }
      .rl-bar {
        height: 4px;
        background: var(--border);
        border-radius: 2px;
        overflow: hidden;
      }
      .rl-bar-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.5s ease;
      }
      /* ── Suggested Resources Drawer & Popping Icon ── */
      #mindease-resources-toggle { position: relative; }
      #mindease-resources-toggle.has-suggestions { color: var(--accent); }
      .mindease-drawer-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 999;
        backdrop-filter: blur(2px);
        animation: mindeaseFade 0.2s ease;
      }
      .mindease-drawer {
        position: absolute;
        top: 0;
        right: 0;
        width: min(340px, 86%);
        height: 100%;
        background: var(--bg-surface);
        border-left: 1px solid var(--border);
        box-shadow: -8px 0 28px rgba(0,0,0,0.35);
        z-index: 1000;
        display: flex;
        flex-direction: column;
        animation: mindeaseSlideLeft 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes mindeaseSlideLeft {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      @keyframes mindeaseFade {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-surface-alt);
      }
      .drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .suggested-item-card {
        background: var(--bg-base);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px 14px;
        transition: all 0.15s ease;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .suggested-item-card:hover {
        border-color: var(--accent);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
      .suggested-link {
        font-weight: 700;
        font-size: 0.85rem;
        color: var(--accent);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .suggested-link:hover { text-decoration: underline; }
      .suggested-desc {
        font-size: 0.74rem;
        color: var(--text-dim);
        line-height: 1.45;
        margin: 0;
      }
      .suggested-badge {
        display: inline-block;
        font-size: 0.65rem;
        font-weight: 600;
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        padding: 2px 6px;
        border-radius: 4px;
        align-self: flex-start;
      }

      /* ── Notes ── */
      .mindease-note-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
        padding: 10px 12px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        border-left: 3px solid var(--accent);
      }
      .mindease-note-text {
        font-size: 0.8rem;
        color: var(--text-primary);
        line-height: 1.5;
        font-style: italic;
      }
      .mindease-note-meta {
        font-size: 0.62rem;
        color: var(--text-muted);
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .mindease-note-source {
        color: var(--accent);
      }

      /* ── Responsive ── */
      @media (max-width: 520px) {
        #mindease-overlay {
          width: 100vw !important;
          border-left: none !important;
          border-right: none !important;
        }
        #mindease-header { padding: 8px 10px; }
        #mindease-body { padding: 10px; }
        #mindease-stats-bar { gap: 4px; padding: 6px 8px; }
        .mindease-stat { padding: 4px 6px; flex-direction: column; gap: 2px; }
        .mindease-stat .s-icon { display: none; }
        .profile-grid { grid-template-columns: 1fr; }
      }

      @media (max-width: 400px) {
        .mindease-stat .s-label { display: none; }
      }

      @media (min-width: 1600px) {
        #mindease-overlay { width: var(--overlay-width, 580px); }
      }

      @media (max-height: 500px) {
        #mindease-header { padding: 8px 14px; }
        #mindease-stats-bar .s-num { font-size: 0.9rem; }
        .mindease-chunk { padding: 10px; }
      }

      /* ── Reduced motion ── */
      @media (prefers-reduced-motion: reduce) {
        #mindease-overlay,
        .mindease-chunk {
          animation: none !important;
        }
        .rl-bar-fill {
          transition: none !important;
        }
      }

      /* ── Adaptive: DEF Tooltip ── */
      .m-def-term {
        border-bottom: 1px dashed var(--accent);
        cursor: help;
        position: relative;
        color: var(--accent);
      }
      .m-def-term:hover::after {
        content: attr(data-def);
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        background: var(--bg-elevated);
        color: var(--text-primary);
        font-size: 0.72rem;
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid var(--border);
        white-space: nowrap;
        max-width: 280px;
        white-space: normal;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10;
        pointer-events: none;
      }

      /* ── Formula block ── */
      .m-formula {
        display: block;
        padding: 12px 16px;
        background: var(--bg-surface);
        border: 1px solid var(--text-primary);
        border-radius: 6px;
        font-size: 1rem;
        margin: 8px 0;
        overflow-x: auto;
        color: var(--text-primary);
        text-align: center;
      }
      .m-formula .katex { color: var(--text-primary); }
      .m-formula .katex-display { margin: 0; text-align: center; }

      /* ── Adaptive: Slow pace - larger text ── */
      #mindease-overlay[data-pace="slow"] .chunk-body {
        font-size: var(--reader-font-size, 18px);
        line-height: 1.8;
      }
      #mindease-overlay[data-pace="slow"] .mindease-chunk {
        padding: 20px;
      }

      /* ── Adaptive: Second language - prominent DEFs ── */
      #mindease-overlay[data-second-lang="true"] .m-def-term {
        border-bottom: 2px solid var(--accent);
        font-weight: 600;
      }
      #mindease-overlay[data-second-lang="true"] .m-def-term:hover::after {
        font-size: 0.8rem;
        padding: 8px 14px;
        background: var(--accent);
        color: #fff;
      }

      /* ── Adaptive: Concise info density - collapse examples ── */
      #mindease-overlay[data-density="concise"] .is-example .chunk-body {
        opacity: 0.85;
        font-size: 0.82rem;
      }
      .example-detail {
        margin: 8px 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 12px;
        background: var(--bg-surface-alt);
      }
      .example-detail summary {
        cursor: pointer;
        font-weight: 600;
        color: var(--accent);
        font-size: 0.78rem;
      }
      .example-content {
        margin-top: 8px;
        font-size: 0.82rem;
        color: var(--text-dim);
      }

      /* ── Adaptive: Short attention - chunk page highlight ── */
      #mindease-overlay[data-attention="short"] .mindease-chunk {
        animation: fadeIn 0.3s ease;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      #mindease-overlay[data-attention="short"] .mindease-page {
        min-height: 120px;
      }
      #mindease-overlay {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        border-radius: 18px 0 0 18px;
        border: 0;
        border-left: 1px solid var(--border);
        box-shadow: var(--shadow);
      }
      #mindease-overlay[data-theme="light"] {
        --bg-surface: color-mix(in srgb, #d4d4d4 94%, #171717);
        --bg-surface-alt: color-mix(in srgb, #d4d4d4 86%, #171717);
        --text-primary: #171717; --text-dim: rgba(23,23,23,.76); --text-muted: rgba(23,23,23,.60);
        --border: rgba(23,23,23,.18); --accent: #171717;
      }
      #mindease-overlay[data-theme="dark"] {
        --bg-surface: color-mix(in srgb, #171717 92%, #d4d4d4);
        --bg-surface-alt: color-mix(in srgb, #171717 84%, #d4d4d4);
        --text-primary: #d4d4d4; --text-dim: rgba(212,212,212,.80); --text-muted: rgba(212,212,212,.62);
        --border: rgba(212,212,212,.20); --accent: #d4d4d4;
      }
      #mindease-overlay #mindease-header { padding: 14px 16px; }
      #mindease-overlay #mindease-tabs { padding: 7px 12px; gap: 4px; }
      #mindease-overlay .mindease-tab { min-height: 34px; border-radius: 9px; font-size: 11px; }
      #mindease-overlay .mindease-tab.active::after { display: none; }
      #mindease-overlay #mindease-stats-bar { padding: 10px 12px; background: var(--bg-overlay); }
      #mindease-overlay .mindease-stat { background: var(--bg-surface); border-color: var(--border); }
      #mindease-overlay .mindease-stat .s-label { text-transform: none; letter-spacing: normal; }
      #mindease-overlay #mindease-body { padding: 18px; }
      #mindease-overlay .mindease-chunk {
        padding: 18px; border-radius: 12px; margin-bottom: 12px;
        background: var(--bg-surface); border-color: var(--border); animation: none;
      }
      #mindease-overlay .mindease-chunk.has-concept,
      #mindease-overlay .mindease-chunk.color-accent,
      #mindease-overlay .mindease-chunk.color-secondary,
      #mindease-overlay .mindease-chunk.color-tertiary,
      #mindease-overlay .mindease-chunk.color-quaternary { background: var(--bg-surface); border-color: var(--border); }
      #mindease-overlay .chunk-concept-tag { text-transform: none; letter-spacing: normal; border-radius: 7px; }
      #mindease-overlay .chunk-body { font-size: var(--reader-font-size, 16px); line-height: 1.75; text-align: start; }
      #mindease-overlay .chunk-body p { margin: 0 0 14px; }
      #mindease-overlay[data-dyslexia="true"] .chunk-body { font-family: Verdana, Arial, sans-serif; letter-spacing: .02em; line-height: 1.8; }
      #mindease-overlay[data-reduced-motion="true"] *, #mindease-overlay[data-reduced-motion="true"] *::before, #mindease-overlay[data-reduced-motion="true"] *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
      #mindease-overlay .adapted-label { text-transform: none; letter-spacing: normal; font-size: 12px; }
      #mindease-overlay button { min-height: 36px; border-radius: 9px; }
      #mindease-overlay button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
      #mindease-overlay .m-formula .katex { color: var(--text-primary); }
      @media (prefers-reduced-motion: reduce) {
        #mindease-overlay * { animation: none !important; transition: none !important; }
      }


      #mindease-overlay .mindease-chunk {border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;padding:0!important;margin:0 0 20px!important;}
      #mindease-overlay .mindease-chunk::before {display:none!important;}
      #mindease-overlay .chunk-body {font-size:16px;line-height:1.8;max-width:72ch;}
      #mindease-overlay .chunk-body h1,
      #mindease-overlay .chunk-body h2,
      #mindease-overlay .chunk-body h3,
      #mindease-overlay .chunk-body h4,
      #mindease-overlay .chunk-body h5,
      #mindease-overlay .chunk-body h6 {
        color: var(--text-primary) !important;
        -webkit-text-fill-color: var(--text-primary) !important;
        line-height: 1.3;
        margin: 1.4em 0 .6em;
      }
      #mindease-overlay[data-theme="dark"] #mindease-header,
      #mindease-overlay[data-theme="dark"] #mindease-header .logo-text {
        color: #d4d4d4 !important;
        -webkit-text-fill-color: #d4d4d4 !important;
      }
      #mindease-overlay .chunk-body p {margin:0 0 1em;}
      #mindease-overlay .chunk-body table {border-collapse:collapse;width:100%;}
      #mindease-overlay .chunk-body td,#mindease-overlay .chunk-body th {border:1px solid var(--border);padding:8px;text-align:left;}
      #mindease-overlay .chunk-body pre {overflow:auto;padding:12px;background:var(--bg-elevated);}
      #mindease-overlay .chunk-speak-btn {float:right;position:static;opacity:.6;}
      #mindease-overlay[data-density="concise"] .is-example .chunk-body {max-height:none;overflow:visible;}
      #mindease-overlay .source-disclosure {font-size:11px;opacity:.7;margin-top:4px;}
      #mindease-overlay .mindease-inline-visual {margin:28px 0;}
      #mindease-overlay .mindease-visual-img-wrap {position:relative;display:block;border-radius:8px;overflow:hidden;background:var(--bg-elevated);border:1px solid var(--border);}
      #mindease-overlay .mindease-inline-visual img {width:100%;height:auto;display:block;border-radius:8px;cursor:zoom-in;transition:transform 0.2s ease;}
      #mindease-overlay .mindease-inline-visual:hover img {transform:scale(1.012);}
      #mindease-overlay .mindease-visual-zoom-btn {
        position:absolute;right:10px;bottom:10px;
        background:rgba(15,23,42,0.85);backdrop-filter:blur(6px);color:#fff;
        border:1px solid rgba(255,255,255,0.25);border-radius:6px;
        padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer;
        display:inline-flex;align-items:center;gap:4px;z-index:2;
        transition:all 0.15s ease;
      }
      #mindease-overlay .mindease-visual-zoom-btn:hover {background:var(--accent);color:#fff;border-color:var(--accent);}
      #mindease-overlay .mindease-inline-visual figcaption {font-size:12px;margin-top:8px;color:var(--text-dim);}
      .mindease-lightbox {
        position:fixed;inset:0;z-index:2147483647;
        display:flex;flex-direction:column;
        background:rgba(5,7,15,0.92);backdrop-filter:blur(12px);
        animation:mindease-fade-in 0.18s ease-out;
      }
      .mindease-lightbox-header {
        display:flex;align-items:center;justify-content:space-between;
        padding:12px 20px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.12);
        background:rgba(0,0,0,0.3);flex-shrink:0;
      }
      .mindease-lightbox-title {
        font-size:0.92rem;font-weight:600;color:#f8fafc;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50vw;
      }
      .mindease-lightbox-controls {
        display:flex;align-items:center;gap:8px;
      }
      .mindease-lightbox-btn {
        background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);
        color:#f8fafc;padding:5px 10px;border-radius:6px;cursor:pointer;
        font-size:0.75rem;font-weight:500;display:inline-flex;align-items:center;gap:4px;
        transition:background 0.15s, transform 0.1s;
      }
      .mindease-lightbox-btn:hover {background:rgba(255,255,255,0.2);}
      .mindease-lightbox-btn:active {transform:scale(0.97);}
      .mindease-lightbox-zoom-val {
        font-size:0.75rem;font-weight:600;color:#94a3b8;min-width:44px;text-align:center;
      }
      .mindease-lightbox-body {
        flex:1;overflow:auto;display:grid;place-items:center;padding:24px;
        user-select:none;cursor:grab;position:relative;
      }
      .mindease-lightbox-body:active {cursor:grabbing;}
      .mindease-lightbox-img {
        max-width:88vw;max-height:82vh;object-fit:contain;
        border-radius:8px;transition:transform 0.15s ease-out;
        box-shadow:0 12px 48px rgba(0,0,0,0.6);
        pointer-events:auto;
      }
      #mindease-overlay .visual-pending {min-height:130px;display:grid;place-items:center;gap:12px;padding:24px;border:1px dashed var(--border);border-radius:12px;background:var(--bg-surface);color:var(--text-dim);font-size:13px;}
      #mindease-overlay .visual-pending-art {display:flex;align-items:center;gap:14px;height:36px;}
      #mindease-overlay .visual-pending-art span {width:22px;height:22px;border:2px solid var(--accent);border-radius:6px;animation:mindease-diagram-pulse 1.8s ease-in-out infinite;}
      #mindease-overlay .visual-pending-art span:nth-child(2) {animation-delay:.3s;}
      #mindease-overlay .visual-pending-art span:nth-child(3) {animation-delay:.6s;}
      @keyframes mindease-diagram-pulse {0%,100% {opacity:.35;transform:translateY(0);} 50% {opacity:1;transform:translateY(-5px);}}
      @media (prefers-reduced-motion:reduce) {#mindease-overlay .visual-pending-art span {animation:none;opacity:.7;}}
      #mindease-overlay #mindease-reader-actions {display:flex;gap:8px;padding:12px 18px;}
      #mindease-overlay .logo-icon {background:var(--accent);color:var(--bg-surface);}
      #mindease-overlay .logo-icon svg {stroke:currentColor;}
`;

/* ═══════════════════════════════════════════════════════════════════════════════
   Overlay helpers (module-level for reuse in appendToOverlay)
   ═══════════════════════════════════════════════════════════════════════════════ */

function formatChunkText(raw: string): string {
  return renderMarkdown(raw.replace(/\[DEF:\s*[^\]]+\]/gi, ""));
}

function autoDetectFormula(text: string): boolean {
  if (text.length < 3) return false;
  const alphaChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalChars = text.replace(/\s/g, "").length;
  if (totalChars === 0) return false;
  const alphaRatio = alphaChars / totalChars;
  if (alphaRatio > 0.6) return false;
  const mathSignals = [
    /[∑∫πΔλ∂∇∞≜±∝∴∵∀∃∈∉⊂⊃∩∪→←↔⇒⇔¬∧∨⊕⊗‖]/,
    /log\d*\(/,
    /\b[HID]\s*\([^)]*\)\s*[=≤≥]/,
    /D_\w+\s*\(/,
    /\d\s*[=×÷^]\s*\d/,
  ];
  return mathSignals.some(r => r.test(text));
}

function stripInlineTags(text: string, preserveFormulas = false): string {
  return text
    .replace(/\[CONCEPT:[^\]]+\]/g, "")
    .replace(/\[SUMMARY:[^\]]+\]/g, "")
    .replace(/\[CHUNK\s*\d*\]/gi, "")
    .replace(/^---+$/gm, "")
    .replace(/\[\/?EXAMPLE(?:_END)?\]/gi, "")
    .replace(/\[\/?FORMULA\]/gi, marker => preserveFormulas ? marker : "")
    .trim();
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Selection-based Explanation Popup (Wikipedia-style)
   ═══════════════════════════════════════════════════════════════════════════════ */

const EXPLAIN_POPUP_CSS = `
#mindease-explain-popup {
  position: fixed;
  z-index: 2147483646;
  background: var(--bg-surface, #171717);
  border: 1px solid var(--border, #d4d4d4);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  max-width: 360px;
  min-width: 200px;
  padding: 0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 0.8rem;
  line-height: 1.55;
  color: var(--text-primary, #d4d4d4);
  display: none;
  animation: mindease-fadeUp 0.15s ease;
  overflow: hidden;
}
#mindease-explain-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--accent, #d4d4d4) 10%, transparent);
  border-bottom: 1px solid var(--border, #d4d4d4);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--accent, #d4d4d4);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
#mindease-explain-close {
  background: none;
  border: none;
  color: var(--text-muted, #d4d4d4);
  cursor: pointer;
  padding: 2px;
  font-size: 14px;
  line-height: 1;
  border-radius: 4px;
}
#mindease-explain-close:hover { color: var(--text-primary, #d4d4d4); }
#mindease-explain-loader {
  padding: 16px;
  text-align: center;
  color: var(--text-muted, #d4d4d4);
  font-size: 0.75rem;
}
#mindease-explain-loader::after {
  content: '';
  display: inline-block;
  width: 12px; height: 12px;
  margin-left: 6px;
  border: 2px solid var(--border, #d4d4d4);
  border-top-color: var(--accent, #d4d4d4);
  border-radius: 50%;
  animation: mindease-spin 0.6s linear infinite;
  vertical-align: middle;
}
#mindease-explain-body {
  padding: 10px 12px;
  display: none;
  font-size: 0.8rem;
  color: var(--text-primary, #d4d4d4);
}
#mindease-explain-selected {
  padding: 6px 12px;
  font-size: 0.72rem;
  color: var(--text-dim, #d4d4d4);
  font-style: italic;
  border-top: 1px solid var(--border, #d4d4d4);
  background: color-mix(in srgb, var(--bg-base, #171717) 40%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;

function setupSelectionPopup(container: HTMLElement): void {
  injectShadowStyle("mindease-explain-styles", EXPLAIN_POPUP_CSS);

  if (shadowById("mindease-explain-popup")) return;
  const popup = document.createElement("div");
  popup.id = "mindease-explain-popup";
  replaceSanitizedHtml(popup, `
    <div id="mindease-explain-header">
      <span>Explain selection</span>
      <button id="mindease-explain-close">&times;</button>
    </div>
    <div id="mindease-explain-loader" style="display:none">Getting explanation</div>
    <div id="mindease-explain-body"></div>
    <div id="mindease-explain-selected"></div>
  `);
  appendToShadow(popup);

  popup.querySelector("#mindease-explain-close")?.addEventListener("click", () => {
    popup.style.display = "none";
  });

  container.addEventListener("mouseup", (e: Event) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }
    const text = sel.toString().trim().slice(0, 300);
    if (text.length < 3) return;

    const body = shadowById("mindease-explain-body");
    const loader = shadowById("mindease-explain-loader");
    const selected = shadowById("mindease-explain-selected");
    if (!body || !loader || !selected) return;

    body.style.display = "none";
    loader.style.display = "block";
    selected.textContent = `"${text.slice(0, 120)}${text.length > 120 ? "..." : ""}"`;

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const popupW = 360;
    let left = rect.left + rect.width / 2 - popupW / 2;
    let top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
    if (top + 200 > window.innerHeight) top = rect.top - 8 - 150;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.display = "block";

    browser.runtime.sendMessage({
      type: "EXPLAIN_SELECTION",
      payload: text,
    }).catch(() => {});
  });

  document.addEventListener("mousedown", (e: Event) => {
    if (!e.composedPath().includes(popup)) {
      popup.style.display = "none";
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Context Menu: Explain Selection (Copilot-style thinking + popup)
   ═══════════════════════════════════════════════════════════════════════════════ */

const CTX_EXPLAIN_CSS = `
#mindease-ctx-loading {
  position: fixed;
  z-index: 2147483646;
  background: color-mix(in srgb, var(--accent, #d4d4d4) 12%, var(--bg-surface, #171717));
  border: 1px solid var(--border, #d4d4d4);
  border-radius: 8px;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 0.75rem;
  color: var(--accent, #d4d4d4);
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  animation: mindease-fadeUp 0.12s ease;
  pointer-events: none;
}
#mindease-ctx-loading .ctx-loader-icon {
  display: inline-flex;
  animation: mindease-spin 0.8s linear infinite;
}
#mindease-ctx-loading .ctx-loader-dots::after {
  content: '';
  animation: mindease-dots 1.4s steps(4, end) infinite;
}
@keyframes mindease-dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}
@keyframes mindease-fadeUp {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes mindease-spin {
  to { transform: rotate(360deg); }
}
#mindease-ctx-popup {
  position: fixed;
  z-index: 2147483646;
  background: var(--bg-surface, #171717);
  border: 1px solid var(--border, #d4d4d4);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  max-width: 360px;
  min-width: 200px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 0.8rem;
  line-height: 1.55;
  color: var(--text-primary, #d4d4d4);
  display: none;
  animation: mindease-fadeUp 0.15s ease;
  overflow: hidden;
}
#mindease-ctx-popup .ctx-popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--accent, #d4d4d4) 10%, transparent);
  border-bottom: 1px solid var(--border, #d4d4d4);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--accent, #d4d4d4);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
#mindease-ctx-popup .ctx-popup-close {
  background: none;
  border: none;
  color: var(--text-muted, #d4d4d4);
  cursor: pointer;
  padding: 2px;
  font-size: 14px;
  line-height: 1;
  border-radius: 4px;
}
#mindease-ctx-popup .ctx-popup-close:hover { color: var(--text-primary, #d4d4d4); }
#mindease-ctx-popup .ctx-popup-body {
  padding: 12px 14px;
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--text-primary, #d4d4d4);
  word-wrap: break-word;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
`;

function injectCtxStyles(): void {
  if (shadowById("mindease-ctx-styles")) return;
  const el = document.createElement("style");
  el.id = "mindease-ctx-styles";
  el.textContent = CTX_EXPLAIN_CSS;
  getMindeaseShadow().appendChild(el);
}

function getSelectionRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  return sel.getRangeAt(0).getBoundingClientRect();
}

function showContextExplainLoading(text: string): void {
  injectCtxStyles();
  let loader = shadowById("mindease-ctx-loading");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "mindease-ctx-loading";
    replaceSanitizedHtml(loader, `<span class="ctx-loader-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </span><span class="ctx-loader-text">Thinking</span><span class="ctx-loader-dots"></span>`);
    appendToShadow(loader);
  }
  loader.style.display = "flex";

  // Position near selection
  const rect = getSelectionRect();
  if (rect) {
    let left = rect.right + 12;
    let top = rect.top;
    if (left + 180 > window.innerWidth) left = rect.left - 180;
    if (left < 8) left = 8;
    if (top + 40 > window.innerHeight) top = rect.top - 40;
    if (top < 8) top = 8;
    loader.style.left = `${left}px`;
    loader.style.top = `${top}px`;
  } else {
    loader.style.left = "50%";
    loader.style.top = "50%";
  }
}

function showContextExplainResult(_text: string, explanation: string): void {
  const loader = shadowById("mindease-ctx-loading");
  if (loader) loader.remove();

  injectCtxStyles();
  let popup = shadowById("mindease-ctx-popup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "mindease-ctx-popup";
    popup.style.cssText = `
      position:fixed;z-index:2147483646;
      max-width:min(420px,calc(100vw - 32px));
      max-height:calc(100vh - 32px);
      display:flex;flex-direction:column;
      left:50%;top:50%;transform:translate(-50%,-50%);
    `;
    replaceSanitizedHtml(popup, `
      <div class="ctx-popup-header">
        <span>MindEase</span>
        <button class="ctx-popup-close">&times;</button>
      </div>
      <div class="ctx-popup-body"></div>
    `);
    const bodyEl = popup.querySelector(".ctx-popup-body");
    if (bodyEl) replaceSanitizedHtml(bodyEl, renderMarkdown(explanation));
    appendToShadow(popup);

    popup.querySelector(".ctx-popup-close")?.addEventListener("click", () => popup!.remove());

    // Dismiss on outside click
    document.addEventListener("mousedown", function dismiss(e) {
      if (!e.composedPath().includes(popup!)) {
        popup!.remove();
        document.removeEventListener("mousedown", dismiss);
      }
    });
  } else {
    const body = popup.querySelector(".ctx-popup-body");
    if (body) replaceSanitizedHtml(body, renderMarkdown(explanation));
  }
  popup.style.display = "flex";
}

/* ═══════════════════════════════════════════════════════════════════════════════
   OCR Result Popup
   ═══════════════════════════════════════════════════════════════════════════════ */

let _ocrPopup: HTMLElement | null = null;

function showOcrResult(text?: string, error?: string): void {
  _ocrPopup?.remove();

  const popup = document.createElement("div");
  _ocrPopup = popup;
  popup.id = "mindease-ocr-popup";

  const headerText = error ? "OCR Failed" : "Extracted Text";
  const bodyContent = error
    ? `<p style="color:var(--danger);margin:0">${_escHtml(error)}</p>`
    : `<div style="white-space:pre-wrap;font-size:0.82rem;line-height:1.6;max-height:300px;overflow-y:auto">${renderMarkdown(text ?? "")}</div>`;

  replaceSanitizedHtml(popup, `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);width:400px;max-width:90vw;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)">
        <span style="font-weight:600;font-size:0.82rem">${headerText}</span>
        <button id="mindease-ocr-close" style="background:none;border:none;cursor:pointer;color:var(--text-dim);padding:4px;font-size:18px;line-height:1">&times;</button>
      </div>
      <div style="padding:14px 16px">${bodyContent}</div>
    </div>`);

  popup.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;
    font-family:system-ui,-apple-system,sans-serif;
  `;

  appendToShadow(popup);

  popup.querySelector("#mindease-ocr-close")?.addEventListener("click", () => {
    popup.remove();
    _ocrPopup = null;
  });

  // Close on outside click
  popup.addEventListener("mousedown", (e) => {
    if (e.target === popup) {
      popup.remove();
      _ocrPopup = null;
    }
  });

  // Close on Escape
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      popup.remove();
      _ocrPopup = null;
      window.removeEventListener("keydown", keyHandler);
    }
  };
  window.addEventListener("keydown", keyHandler);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Context Menu: Capture & Explain (crop tool + placeholder)
   ═══════════════════════════════════════════════════════════════════════════════ */

const CAPTURE_CSS = `
#mindease-capture-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
#mindease-capture-overlay .cap-image-wrap {
  position: relative;
  max-width: 90vw;
  max-height: 85vh;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 8px 48px rgba(0,0,0,0.5);
  cursor: crosshair;
}
#mindease-capture-overlay .cap-image-wrap img {
  display: block;
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
}
#mindease-capture-overlay .cap-selection {
  position: absolute;
  border: 2px dashed #fff;
  background: rgba(247, 230, 202,0.08);
  pointer-events: none;
  display: none;
}
#mindease-capture-overlay .cap-toolbar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 10;
}
#mindease-capture-overlay .cap-toolbar button {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  transition: opacity 0.12s;
}
#mindease-capture-overlay .cap-toolbar button:hover { opacity: 0.85; }
#mindease-capture-overlay .cap-toolbar .cap-confirm {
  background: var(--accent, #d4d4d4);
  color: #171717;
}
#mindease-capture-overlay .cap-toolbar .cap-cancel {
  background: var(--bg-surface, #171717);
  color: var(--text-dim, #d4d4d4);
  border: 1px solid var(--border, #d4d4d4);
}

#mindease-capture-result {
  position: fixed;
  z-index: 2147483647;
  background: var(--bg-surface, #171717);
  border: 1px solid var(--border, #d4d4d4);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  max-width: 480px;
  min-width: 280px;
  overflow: hidden;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 0.8rem;
  color: var(--text-primary, #d4d4d4);
  animation: mindease-fadeUp 0.15s ease;
}
#mindease-capture-result .cap-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--accent, #d4d4d4) 10%, transparent);
  border-bottom: 1px solid var(--border, #d4d4d4);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--accent, #d4d4d4);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
#mindease-capture-result .cap-result-close {
  background: none;
  border: none;
  color: var(--text-muted, #d4d4d4);
  cursor: pointer;
  padding: 2px;
  font-size: 14px;
  line-height: 1;
}
#mindease-capture-result .cap-result-close:hover { color: var(--text-primary, #d4d4d4); }
#mindease-capture-result .cap-result-body {
  padding: 12px;
}
#mindease-capture-result .cap-result-body img {
  display: block;
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid var(--border, #d4d4d4);
  margin-bottom: 10px;
}
#mindease-capture-result .cap-result-body .cap-ocr-placeholder {
  text-align: center;
  color: var(--text-dim, #d4d4d4);
  font-size: 0.75rem;
  padding: 8px;
  background: color-mix(in srgb, var(--accent, #d4d4d4) 8%, transparent);
  border-radius: 6px;
  border: 1px dashed var(--border, #d4d4d4);
}
`;

function injectCaptureStyles(): void {
  if (shadowById("mindease-cap-styles")) return;
  const el = document.createElement("style");
  el.id = "mindease-cap-styles";
  el.textContent = CAPTURE_CSS;
  getMindeaseShadow().appendChild(el);
}

function showCaptureCropTool(dataUrl: string): void {
  injectCaptureStyles();

  // Remove previous overlay if any
  shadowById("mindease-capture-overlay")?.remove();
  shadowById("mindease-capture-result")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "mindease-capture-overlay";
  replaceSanitizedHtml(overlay, `
    <div class="cap-image-wrap">
      <img src="${dataUrl}" alt="Screenshot" />
      <div class="cap-selection" id="cap-selection"></div>
      <div class="cap-toolbar">
        <button class="cap-confirm" id="cap-confirm">Explain region</button>
        <button class="cap-cancel" id="cap-cancel">Cancel</button>
      </div>
    </div>
  `);
  appendToShadow(overlay);

  const wrap = overlay.querySelector(".cap-image-wrap") as HTMLElement;
  const selEl = shadowById("cap-selection") as HTMLElement;
  // Capture result will be created on confirm

  let dragging = false;
  let startX = 0, startY = 0;
  const sel: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };

  const onMouseDown = (e: MouseEvent) => {
    const rect = wrap.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    dragging = true;
    selEl.style.display = "block";
    selEl.style.left = `${startX}px`;
    selEl.style.top = `${startY}px`;
    selEl.style.width = "0px";
    selEl.style.height = "0px";
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const rect = wrap.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    sel.x = Math.min(startX, cx);
    sel.y = Math.min(startY, cy);
    sel.w = Math.abs(cx - startX);
    sel.h = Math.abs(cy - startY);
    selEl.style.left = `${sel.x}px`;
    selEl.style.top = `${sel.y}px`;
    selEl.style.width = `${sel.w}px`;
    selEl.style.height = `${sel.h}px`;
  };

  const onMouseUp = () => {
    dragging = false;
  };

  wrap.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  shadowById("cap-cancel")?.addEventListener("click", () => {
    overlay.remove();
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  });

  shadowById("cap-confirm")?.addEventListener("click", () => {
    if (sel.w < 10 || sel.h < 10) return;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    // Crop the screenshot to the selection using canvas
    const img = new Image();
    img.onload = () => {
      const imgRect = wrap.querySelector("img")!.getBoundingClientRect();
      const scaleX = img.naturalWidth / imgRect.width;
      const scaleY = img.naturalHeight / imgRect.height;

      const canvas = document.createElement("canvas");
      canvas.width = sel.w * scaleX;
      canvas.height = sel.h * scaleY;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(
        img,
        sel.x * scaleX, sel.y * scaleY, sel.w * scaleX, sel.h * scaleY,
        0, 0, canvas.width, canvas.height,
      );

      const croppedDataUrl = canvas.toDataURL("image/png");
      overlay.remove();
      showCaptureResult(croppedDataUrl);
    };
    img.src = dataUrl;
  });
}

function showCaptureResult(croppedDataUrl: string): void {
  // Ensure KaTeX CSS is loaded for formula rendering
  if (!shadowById("mindease-katex-css")) {
    const link = document.createElement("link");
    link.id = "mindease-katex-css";
    link.rel = "stylesheet";
    link.href = browser.runtime.getURL(katexStyles.replace(/^\//, ""));
    getMindeaseShadow().appendChild(link);
  }

  const popup = document.createElement("div");
  popup.id = "mindease-capture-result";

  popup.style.cssText = `
    position:fixed;z-index:2147483646;
    max-width:min(500px,calc(100vw - 32px));
    max-height:calc(100vh - 32px);
    display:flex;flex-direction:column;
    background:var(--bg-surface,#171717);
    border:1px solid var(--border,#d4d4d4);
    border-radius:14px;
    box-shadow:0 8px 32px rgba(0,0,0,0.35);
    overflow:hidden;
  `;
  // Center in viewport
  popup.style.left = "50%";
  popup.style.top = "50%";
  popup.style.transform = "translate(-50%,-50%)";

  replaceSanitizedHtml(popup, `
    <div class="cap-result-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border,#d4d4d4);font-size:0.82rem;font-weight:600;color:var(--accent,#d4d4d4)">
      <span>Captured region</span>
      <button class="cap-result-close" style="background:none;border:none;cursor:pointer;padding:2px 8px;font-size:16px;color:var(--text-muted,#d4d4d4)">&times;</button>
    </div>
    <div class="cap-result-body" style="padding:12px 14px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:10px">
      <img src="${croppedDataUrl}" alt="Captured region" style="max-width:100%;height:auto;border-radius:8px" />
      <div class="cap-ocr-placeholder" style="font-size:0.82rem;color:var(--text-dim,#d4d4d4)">
        OCR in progress...
      </div>
    </div>
  `);
  appendToShadow(popup);

  popup.querySelector(".cap-result-close")?.addEventListener("click", () => popup.remove());
  document.addEventListener("mousedown", function dismiss(e) {
    if (!e.composedPath().includes(popup)) {
      popup.remove();
      document.removeEventListener("mousedown", dismiss);
    }
  });

  browser.runtime.sendMessage({
    type: "OCR_IMAGE",
    payload: { base64Image: croppedDataUrl },
  }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Floating Selection TTS Player
   ═══════════════════════════════════════════════════════════════════════════════ */

let _floatingTtsEl: HTMLElement | null = null;
let _floatingTtsRate = 1.0;
let _floatingTtsText = "";

const FLOATING_TTS_CSS = `
#mindease-floating-tts {
  position: fixed;
  z-index: 2147483646;
  width: 330px;
  max-width: calc(100vw - 32px);
  background: var(--bg-surface, #171717);
  border: 1px solid var(--border, #d4d4d4);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: var(--text-primary, #d4d4d4);
  overflow: hidden;
  animation: mindease-fadeUp 0.18s ease;
}
#mindease-floating-tts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--accent, #d4d4d4) 12%, var(--bg-surface, #171717));
  border-bottom: 1px solid var(--border, #d4d4d4);
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--accent, #d4d4d4);
}
#mindease-floating-tts-close {
  background: none;
  border: none;
  color: var(--text-muted, #d4d4d4);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 16px;
  line-height: 1;
}
#mindease-floating-tts-close:hover { color: var(--text-primary, #d4d4d4); }
#mindease-floating-tts-body {
  padding: 10px 12px;
  font-size: 0.8rem;
  line-height: 1.55;
  max-height: 100px;
  overflow-y: auto;
  color: var(--text-primary, #d4d4d4);
  background: color-mix(in srgb, var(--bg-base, #171717) 50%, transparent);
  border-bottom: 1px solid var(--border, #d4d4d4);
}
#mindease-floating-tts-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  gap: 8px;
}
.mindease-tts-btn-icon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--accent, #d4d4d4);
  color: #171717;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.mindease-tts-btn-icon:hover { opacity: 0.9; }
.mindease-tts-btn-secondary {
  background: transparent;
  color: var(--text-dim, #d4d4d4);
  border: 1px solid var(--border, #d4d4d4);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 0.72rem;
  cursor: pointer;
}
.mindease-tts-btn-secondary:hover { color: var(--text-primary, #d4d4d4); border-color: var(--accent, #d4d4d4); }
.mindease-tts-speed-group {
  display: flex;
  gap: 3px;
  align-items: center;
}
.mindease-tts-speed-btn {
  padding: 2px 6px;
  font-size: 0.68rem;
  border-radius: 4px;
  border: 1px solid var(--border, #d4d4d4);
  background: transparent;
  color: var(--text-dim, #d4d4d4);
  cursor: pointer;
}
.mindease-tts-speed-btn.active {
  background: var(--accent, #d4d4d4);
  color: #171717;
  font-weight: 600;
  border-color: var(--accent, #d4d4d4);
}
`;

function injectFloatingTtsStyles(): void {
  if (shadowById("mindease-floating-tts-styles")) return;
  const el = document.createElement("style");
  el.id = "mindease-floating-tts-styles";
  el.textContent = FLOATING_TTS_CSS;
  getMindeaseShadow().appendChild(el);
}

function hideFloatingTtsPlayer(): void {
  ttsStop();
  if (_floatingTtsEl) {
    _floatingTtsEl.remove();
    _floatingTtsEl = null;
  }
}

function showFloatingTtsPlayer(text: string, initialRect?: DOMRect | null): void {
  injectFloatingTtsStyles();
  hideFloatingTtsPlayer();

  _floatingTtsText = text.trim();
  if (!_floatingTtsText) return;

  loadTtsSettings().then((settings) => {
    _floatingTtsRate = settings.rate || 1.0;
    renderPlayer();
  });

  function renderPlayer(): void {
    const el = document.createElement("div");
    _floatingTtsEl = el;
    el.id = "mindease-floating-tts";
    replaceSanitizedHtml(el, `
      <div id="mindease-floating-tts-header">
        <div style="display:flex;align-items:center;gap:6px">
          ${iconHTML("volume-2")}
          <span>MindEase Reader</span>
          <span id="mindease-tts-counter" style="font-size:0.68rem;color:var(--text-dim,#d4d4d4)"></span>
        </div>
        <button id="mindease-floating-tts-close" title="Close reader">&times;</button>
      </div>
      <div id="mindease-floating-tts-body">${_escHtml(_floatingTtsText)}</div>
      <div id="mindease-floating-tts-controls">
        <div style="display:flex;gap:6px;align-items:center">
          <button class="mindease-tts-btn-icon" id="mindease-ft-playpause">Pause</button>
          <button class="mindease-tts-btn-secondary" id="mindease-ft-stop">Stop</button>
        </div>
        <div class="mindease-tts-speed-group">
          <button class="mindease-tts-speed-btn${_floatingTtsRate === 0.75 ? " active" : ""}" data-rate="0.75">0.75x</button>
          <button class="mindease-tts-speed-btn${_floatingTtsRate === 1.0 ? " active" : ""}" data-rate="1">1x</button>
          <button class="mindease-tts-speed-btn${_floatingTtsRate === 1.25 ? " active" : ""}" data-rate="1.25">1.25x</button>
          <button class="mindease-tts-speed-btn${_floatingTtsRate === 1.5 ? " active" : ""}" data-rate="1.5">1.5x</button>
        </div>
      </div>
    `);

    appendToShadow(el);

    const rect = initialRect || getSelectionRect();
    const popupW = 330;
    let left = window.innerWidth - popupW - 24;
    let top = window.innerHeight - 190;
    if (rect && rect.width > 0) {
      left = rect.left + rect.width / 2 - popupW / 2;
      top = rect.bottom + 10;
      if (left < 12) left = 12;
      if (left + popupW > window.innerWidth - 12) left = window.innerWidth - popupW - 12;
      if (top + 170 > window.innerHeight) top = Math.max(12, rect.top - 180);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;

    const closeBtn = el.querySelector("#mindease-floating-tts-close");
    closeBtn?.addEventListener("click", hideFloatingTtsPlayer);

    const playPauseBtn = el.querySelector("#mindease-ft-playpause") as HTMLButtonElement | null;
    const stopBtn = el.querySelector("#mindease-ft-stop") as HTMLButtonElement | null;
    const bodyEl = el.querySelector("#mindease-floating-tts-body") as HTMLElement | null;
    const counterEl = el.querySelector("#mindease-tts-counter") as HTMLElement | null;

    playPauseBtn?.addEventListener("click", () => {
      if (isSpeaking() && !isPaused()) {
        ttsPause();
        if (playPauseBtn) playPauseBtn.textContent = "Play";
      } else if (isPaused()) {
        ttsResume();
        if (playPauseBtn) playPauseBtn.textContent = "Pause";
      } else {
        startSpeaking();
      }
    });

    stopBtn?.addEventListener("click", () => {
      ttsStop();
      if (playPauseBtn) playPauseBtn.textContent = "Play";
      if (counterEl) counterEl.textContent = "Stopped";
    });

    el.querySelectorAll(".mindease-tts-speed-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rate = parseFloat((btn as HTMLElement).dataset.rate || "1.0");
        _floatingTtsRate = rate;
        saveTtsSettings({ rate });
        el.querySelectorAll(".mindease-tts-speed-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        startSpeaking();
      });
    });

    function startSpeaking(): void {
      if (playPauseBtn) playPauseBtn.textContent = "Pause";
      ttsSpeak(_floatingTtsText, {
        rate: _floatingTtsRate,
        onProgress: (idx, total, sentence) => {
          if (counterEl) counterEl.textContent = `(${idx + 1}/${total})`;
          if (bodyEl) {
            replaceSanitizedHtml(bodyEl, `<span style="background:color-mix(in srgb,var(--accent,#d4d4d4) 30%,transparent);border-radius:3px;padding:2px 4px">${_escHtml(sentence)}</span>`);
          }
        },
        onEnd: () => {
          if (playPauseBtn) playPauseBtn.textContent = "Replay";
          if (counterEl) counterEl.textContent = "Done";
        },
        onError: () => {
          if (playPauseBtn) playPauseBtn.textContent = "Play";
        },
      }).catch(() => {});
    }

    startSpeaking();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Floating Overlay Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function appendToOverlay(chunks: ContentChunk[]): void {
  const container = shadowById("tab-content");
  const marker = shadowById("mindease-loading-marker");
  if (!container) return;
  _contentChunks.push(...chunks);
  // Narration reads rendered .chunk-body elements, not Markdown/source disclosure.
  const palette = ["accent", "secondary", "tertiary", "quaternary"];
  const existing = container.querySelectorAll(".mindease-chunk").length;
  const html = chunks.map((chunk, i) => {
    const concept = chunk.conceptTags[0] ?? "";
    const cleanText = chunk.text
      .replace(/\[CONCEPT:[^\]]+\]/g, "")
      .replace(/\[SUMMARY:[^\]]+\]/g, "")
      .replace(/\[CHUNK\s*\d*\]/gi, "")
      .replace(/^---+$/gm, "")
      .replace(/\[\/?EXAMPLE(?:_END)?\]/gi, "")
      .trim();
    const isAdapted = chunk.sourceText !== undefined && chunk.text.trim() !== chunk.sourceText.trim();
    const bodyHTML = formatChunkText(isAdapted ? cleanText : (chunk.sourceText ?? cleanText));
    const sourceDisclosure = isAdapted
      ? `<details class="source-disclosure"><summary>View original source section</summary><div class="source-disclosure-body">${formatChunkText(chunk.sourceText!)}</div></details>`
      : "";
    const colorKey = palette[(existing + i) % palette.length];
    return `
      <div class="mindease-chunk ${concept ? "has-concept" : ""} color-${colorKey}
           ${chunk.isExample ? "is-example" : ""} ${chunk.hasDefinitions ? "has-defs" : ""}"
           data-chunk-index="${existing + i}" data-source-block="${_escHtml(chunk.id)}">
        <button class="chunk-speak-btn" data-chunk-index="${existing + i}" title="Listen to this section" aria-label="Listen to this section">${iconHTML("volume-2")}</button>
        
        <div class="chunk-body">${bodyHTML}</div>
        ${sourceDisclosure}
        
      </div>
    `;
  }).join("");
  const staged = document.createElement("div");
  replaceSanitizedHtml(staged, html);
  const nodes = [...staged.childNodes];
  if (marker) {
    marker.before(...nodes);
  } else {
    container.append(...nodes);
  }
  _ttsTexts = _contentChunks.map((_, i) => renderedChunkText(i));
  const statEl = shadowById("mindease-engage-count");
  if (statEl) {
    const total = container.querySelectorAll(".mindease-chunk").length;
    statEl.textContent = String(total);
  }
}

async function showRelatedResources(topics: string[], preference: "visual" | "text"): Promise<void> {
  const drawerContent = shadowById("mindease-resources-drawer-content");
  const toggleBtn = shadowById("mindease-resources-toggle");
  const badge = shadowById("mindease-resources-badge");
  if (!drawerContent || !toggleBtn) return;

  const validTopics = topics.filter(topic => topic.length >= 3 && topic.length <= 90);
  if (!validTopics.length) {
    replaceSanitizedHtml(drawerContent, `<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:24px 0">No related topics identified on this page.</p>`);
    return;
  }
  try {
    const reply = await browser.runtime.sendMessage({
      type: "RELATED_RESOURCES",
      payload: { topics: validTopics.slice(0, 3), preference, sourceUrl: location.href },
    }) as { resources?: Array<{ title: string; url: string; description: string; reason: string }> };
    if (!drawerContent.isConnected) return;
    
    const resources = (reply?.resources ?? []).filter(r => {
      try { return new URL(r.url).protocol === "https:"; } catch { return false; }
    });

    if (!resources.length) {
      replaceSanitizedHtml(drawerContent, `<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:24px 0">No related educational websites found for this topic.</p>`);
      return;
    }

    // Show popping indicator badge on the header globe icon
    if (badge) badge.style.display = "block";
    toggleBtn.classList.add("has-suggestions");
    toggleBtn.title = `Explore ${resources.length} suggested learning website(s)`;

    drawerContent.replaceChildren();
    for (const resource of resources) {
      const card = document.createElement("div");
      card.className = "suggested-item-card";

      const link = document.createElement("a");
      link.href = resource.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "suggested-link";
      replaceSanitizedHtml(link, `<span>${resource.title}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`);

      const desc = document.createElement("p");
      desc.className = "suggested-desc";
      desc.textContent = resource.description || resource.reason;

      if (resource.reason && resource.description) {
        const badgeEl = document.createElement("span");
        badgeEl.className = "suggested-badge";
        badgeEl.textContent = resource.reason.includes("illustration") ? "Illustrated" : "Recommended";
        card.append(link, desc, badgeEl);
      } else {
        card.append(link, desc);
      }
      drawerContent.append(card);
    }
  } catch (err) {
    replaceSanitizedHtml(drawerContent, `<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:24px 0">Could not retrieve website suggestions.</p>`);
  }
}

function injectOverlay(
  chunks: ContentChunk[],
  baseline?: BaselineProfile,
  transformationParams?: TransformationParams,
  condition?: CognitiveNeed,
  language?: string,
): void {
  stopTTS();
  _visualEntries = [];
  shadowById("mindease-overlay")?.remove();
  shadowById("mindease-pdf-loader")?.remove();
  removeReopenButton();

  const tParams = transformationParams ?? chunkParams;
  const baselineProfile = baseline ?? defaultBaseline;

  function renderChunkHTML(chunk: ContentChunk, i: number): string {
    const concept = chunk.conceptTags[0] ?? "";
    const summary = chunk.summary ?? "";
    const cleanText = stripInlineTags(chunk.text, true);
    const palette = ["accent", "secondary", "tertiary", "quaternary"];
    const colorKey = palette[i % palette.length];
    const isAdapted = chunk.sourceText !== undefined && chunk.text.trim() !== chunk.sourceText.trim();
    const bodyHTML = formatChunkText(isAdapted ? cleanText : (chunk.sourceText ?? cleanText));
    const sourceDisclosure = isAdapted
      ? `<details class="source-disclosure"><summary>View original source section</summary><div class="source-disclosure-body">${formatChunkText(chunk.sourceText!)}</div></details>`
      : "";

    return `
      <div class="mindease-chunk ${concept ? "has-concept" : ""} color-${colorKey}
           ${chunk.isExample ? "is-example" : ""} ${chunk.hasDefinitions ? "has-defs" : ""}"
           data-chunk-index="${i}" data-source-block="${_escHtml(chunk.id)}">
        <button class="chunk-speak-btn" data-chunk-index="${i}" title="Listen to this section" aria-label="Listen to this section">${iconHTML("volume-2")}</button>
        
        <div class="chunk-body">${bodyHTML}</div>
        ${sourceDisclosure}
        
      </div>
    `;
  }

  let orderedChunks = [...chunks];

  if (chunks.every(chunk => chunk.sourceText !== undefined)) {
    orderedChunks.sort((a, b) => a.position - b.position);
  } else if (baselineProfile.learningApproach === "example-first") {
    const examples = orderedChunks.filter(c => c.isExample);
    const rest = orderedChunks.filter(c => !c.isExample);
    orderedChunks = [...examples, ...rest];
  } else {
    const theory = orderedChunks.filter(c => !c.isExample);
    const examples = orderedChunks.filter(c => c.isExample);
    orderedChunks = [...theory, ...examples];
  }

  _formatPreference = baselineProfile.formatPreference;
  _conceptsFromChunks = [...new Set(orderedChunks.flatMap(c => c.conceptTags).filter(Boolean))];
  _ttsTexts = [];
  _contentChunks = orderedChunks;
  console.log(`[Content] Extracted ${_conceptsFromChunks.length} concepts, ${_contentChunks.length} chunks`);
  const totalConcepts = orderedChunks.reduce((acc, c) => acc + c.conceptTags.length, 0);
  const summaryCount = orderedChunks.filter(c => c.summary).length;

  const defaultTab = "content";

  const infoDensity = baselineProfile.infoDensity;
  const secondLang = baselineProfile.secondLanguageLearner;
  const readingPace = baselineProfile.readingPace;
  const attentionSpan = baselineProfile.attentionSpan;

  try {
    const locale = new Intl.Locale(language || document.documentElement.lang || "en-US").maximize();
    _ttsLanguage = `${locale.language}-${locale.region || "US"}`;
  } catch {
    _ttsLanguage = "en-US";
  }
  const overlay = document.createElement("div");
  overlay.id = "mindease-overlay";
  overlay.setAttribute("data-theme", _theme);
  overlay.setAttribute("data-attention", attentionSpan);
  overlay.setAttribute("data-pace", readingPace);
  overlay.setAttribute("data-density", infoDensity);
  overlay.setAttribute("data-second-lang", String(secondLang));
  overlay.setAttribute("data-dyslexia", String(condition === "dyslexia"));
  overlay.setAttribute("data-reduced-motion", String(baselineProfile.supportHints?.reducedMotion === true || condition === "autism"));
  overlay.style.setProperty("--reader-font-size", `${baselineProfile.supportHints?.largerText || condition === "dyslexia" ? 20 : readingPace === "slow" ? 18 : 16}px`);
  overlay.setAttribute("role", "complementary");
  overlay.setAttribute("aria-label", "MindEase study panel");
  overlay.setAttribute("aria-hidden", "false");

  if (!shadowById("mindease-katex-css")) {
    const link = document.createElement("link");
    link.id = "mindease-katex-css";
    link.rel = "stylesheet";
    link.href = browser.runtime.getURL(katexStyles.replace(/^\//, ""));
    getMindeaseShadow().appendChild(link);
  }

  if (!shadowById("mindease-overlay-styles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "mindease-overlay-styles";
    styleEl.textContent = OVERLAY_CSS;
    getMindeaseShadow().appendChild(styleEl);
  }

  replaceSanitizedHtml(overlay, `
    <div id="mindease-header">
      <div id="mindease-logo">
        <div class="logo-icon">${iconHTML("brain")}</div>
        <span class="logo-text">MindEase</span>
        <span class="logo-badge">ADAPTIVE</span>
      </div>
      <div id="mindease-controls">
        <button class="mindease-ctrl-btn" id="mindease-font-down" title="Decrease text size" aria-label="Decrease text size">A−</button>
        <button class="mindease-ctrl-btn" id="mindease-font-up" title="Increase text size" aria-label="Increase text size">A+</button>
        <button class="mindease-ctrl-btn" id="mindease-resources-toggle" title="Explore suggested websites" aria-label="Explore suggested websites">${iconHTML("globe")}<span id="mindease-resources-badge" style="display:none;position:absolute;top:2px;right:2px;width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 6px var(--accent)"></span></button>
        <button class="mindease-ctrl-btn" id="mindease-tts-btn" title="Read content aloud" aria-label="Read content aloud">${iconHTML("volume-2")}</button>
        <button class="mindease-ctrl-btn" id="mindease-theme-toggle" title="Toggle theme" aria-label="Toggle theme">${_theme === "light" ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'}</button>
        <button class="mindease-ctrl-btn" id="mindease-minimize" title="Minimize" aria-label="Minimize panel">&minus;</button>
        <button class="mindease-ctrl-btn" id="mindease-close" title="Close" aria-label="Close panel">${iconHTML("x")}</button>
      </div>
    </div>

    <div id="mindease-reader-actions"><button class="mindease-btn" id="mindease-video">Generate video</button><button class="mindease-btn" id="mindease-profile-edit">Edit preferences</button></div>

    <div id="mindease-tts-bar" style="display:none;align-items:center;justify-content:space-between;gap:8px;padding:6px 14px;background:color-mix(in srgb,var(--accent) 12%,var(--bg-surface));border-bottom:1px solid var(--border);font-size:0.75rem;color:var(--accent)">
      <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
        <span class="tts-icon">${iconHTML("volume-2")}</span>
        <span class="tts-label" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Speaking&hellip;</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div class="mindease-tts-speed-bar" style="display:flex;gap:2px">
          <button class="mindease-overlay-speed-btn" data-rate="0.75" style="padding:1px 5px;font-size:0.65rem;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--text-dim);cursor:pointer">0.75x</button>
          <button class="mindease-overlay-speed-btn active" data-rate="1" style="padding:1px 5px;font-size:0.65rem;border-radius:3px;border:1px solid var(--accent);background:var(--accent);color:#171717;font-weight:600;cursor:pointer">1x</button>
          <button class="mindease-overlay-speed-btn" data-rate="1.25" style="padding:1px 5px;font-size:0.65rem;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--text-dim);cursor:pointer">1.25x</button>
          <button class="mindease-overlay-speed-btn" data-rate="1.5" style="padding:1px 5px;font-size:0.65rem;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--text-dim);cursor:pointer">1.5x</button>
        </div>
        <button class="mindease-ctrl-btn" id="mindease-tts-pause" title="Pause / Resume" aria-label="Pause or Resume reading" style="width:24px;height:24px;font-size:10px;display:inline-flex;align-items:center;justify-content:center">❚❚</button>
        <button class="mindease-ctrl-btn" id="mindease-tts-stop" title="Stop" aria-label="Stop reading" style="width:24px;height:24px;font-size:10px;display:inline-flex;align-items:center;justify-content:center">&times;</button>
      </div>
    </div>

    <div id="mindease-body">
      <div class="mindease-tab-content${defaultTab === 'content' ? ' active' : ''}" id="tab-content" role="tabpanel" aria-label="Content">
        ${orderedChunks.length === 0
          ? '<p style="color:var(--text-muted);text-align:center;padding:24px">Preparing your reading page…</p>'
          : orderedChunks.map((chunk, ci) => renderChunkHTML(chunk, ci)).join("")
        }
        <div id="mindease-loading-marker" style="display:none;text-align:center;padding:16px;color:var(--text-muted);font-size:0.78rem">
          ${iconHTML("loader")} Loading more content...
        </div>
      </div>

      <div id="mindease-visuals-grid" class="visuals-grid" aria-live="polite"></div>
      <div id="mindease-resources-drawer-backdrop" class="mindease-drawer-backdrop" style="display:none"></div>
      <aside id="mindease-resources-drawer" class="mindease-drawer" aria-label="Suggested learning websites" style="display:none">
        <div class="drawer-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="color:var(--accent)">${iconHTML("globe")}</span>
            <h3 style="margin:0;font-size:0.92rem;font-weight:700;color:var(--text-primary)">Suggested Learning</h3>
          </div>
          <button id="mindease-resources-drawer-close" class="mindease-ctrl-btn" aria-label="Close suggestions">${iconHTML("x")}</button>
        </div>
        <div class="drawer-body" id="mindease-resources-drawer-content">
          <p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:24px 0">Searching for related educational resources&hellip;</p>
        </div>
      </aside>
    </div>

    <div id="mindease-footer">
      <button class="mindease-btn mindease-btn-primary" id="mindease-end-session">End Session</button>
      <button class="mindease-btn mindease-btn-ghost" id="mindease-popout">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Full view
      </button>
      <button class="mindease-btn mindease-btn-ghost" id="mindease-toggle-side">${iconHTML("arrow-left-right")} Side</button>
    </div>
  `);

  appendToShadow(overlay);
  void browser.storage.local.get("mindease_reader_font_size").then(saved => {
    const size = saved.mindease_reader_font_size;
    if (typeof size === "number" && Number.isFinite(size) && size >= 14 && size <= 32) {
      overlay.style.setProperty("--reader-font-size", `${size}px`);
    }
  }).catch(() => {});
  setupSelectionPopup(shadowById("mindease-body")!);
  void showRelatedResources(
    orderedChunks.flatMap(chunk => chunk.conceptTags.filter(tag =>
      (chunk.sourceText ?? chunk.text).toLocaleLowerCase().includes(tag.toLocaleLowerCase()),
    )),
    baselineProfile.formatPreference,
  );



  /* ── Focus first focusable ── */
  setTimeout(() => {
    const firstBtn = overlay.querySelector<HTMLElement>("#mindease-minimize");
    firstBtn?.focus();
  }, 100);

  /* ── Tab switching ── */
  overlay.querySelector("#mindease-video")?.addEventListener("click", () => {
    window.open(browser.runtime.getURL("src/session/dashboard/dashboard.html") + "#video?source=" + encodeURIComponent(location.href), "_blank", "noopener");
  });
  overlay.querySelector("#mindease-profile-edit")?.addEventListener("click", () => {
    window.open(browser.runtime.getURL("src/session/dashboard/dashboard.html") + "#profile", "_blank", "noopener");
  });
  overlay.querySelectorAll(".mindease-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      overlay.querySelectorAll(".mindease-tab").forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      overlay.querySelectorAll(".mindease-tab-content").forEach(t => {
        t.classList.remove("active");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const tabId = (tab as HTMLElement).dataset.tab;
      const panel = shadowById(`tab-${tabId}`);
      panel?.classList.add("active");
      panel?.focus();
      saveSidebarState({ activeTab: tabId as SidebarState["activeTab"] });
    });
  });

  /* ── Close handler ── */
  async function handleClose(): Promise<void> {
    stopTTS();
    overlay.removeAttribute("role");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";
    await saveSidebarState({
      visible: false,
      minimized: false,
      onRight,
      activeTab: shadowQuery(".mindease-tab.active")?.dataset.tab as SidebarState["activeTab"] ?? "content",
      lastScrollY: window.scrollY,
    });
    ensureReopenStyles();
    const btn = injectReopenButton(_theme);
    btn.addEventListener("click", async () => {
      removeReopenButton();
      await saveSidebarState({ visible: true });
      overlay.style.display = "flex";
      overlay.removeAttribute("aria-hidden");
      overlay.setAttribute("role", "complementary");
      setTimeout(() => {
        const firstBtn = overlay.querySelector<HTMLElement>("#mindease-minimize");
        firstBtn?.focus();
      }, 100);
    });
  }

  shadowById("mindease-close")?.addEventListener("click", handleClose);

  /* ── Minimize ── */
  let minimized = false;
  shadowById("mindease-minimize")?.addEventListener("click", () => {
    minimized = !minimized;
    const body = shadowById("mindease-body");
    const tabs = shadowById("mindease-tabs");
    const stats = shadowById("mindease-stats-bar");
    const footer = shadowById("mindease-footer");
    if (minimized) {
      body!.style.display = "none";
      if (tabs) tabs.style.display = "none";
      if (stats) stats.style.display = "none";
      footer!.style.display = "none";
      overlay.style.height = "auto";
    } else {
      body!.style.display = "";
      if (tabs) tabs.style.display = "";
      if (stats) stats.style.display = "";
      footer!.style.display = "";
      overlay.style.height = "100vh";
    }
    saveSidebarState({ minimized });
  });

  /* ── End Session ── */
  shadowById("mindease-end-session")?.addEventListener("click", () => {
    browser.runtime.sendMessage({ type: "SESSION_END" }).catch(() => {});
  });

  /* ── Suggested Resources Drawer Toggling ── */
  const resourcesToggle = shadowById("mindease-resources-toggle");
  const resourcesDrawer = shadowById("mindease-resources-drawer");
  const resourcesBackdrop = shadowById("mindease-resources-drawer-backdrop");
  const resourcesClose = shadowById("mindease-resources-drawer-close");
  const resourcesBadge = shadowById("mindease-resources-badge");

  const openDrawer = () => {
    if (resourcesDrawer && resourcesBackdrop) {
      resourcesDrawer.style.display = "flex";
      resourcesBackdrop.style.display = "block";
      if (resourcesBadge) resourcesBadge.style.display = "none";
    }
  };

  const closeDrawer = () => {
    if (resourcesDrawer && resourcesBackdrop) {
      resourcesDrawer.style.display = "none";
      resourcesBackdrop.style.display = "none";
    }
  };

  resourcesToggle?.addEventListener("click", () => {
    if (resourcesDrawer?.style.display === "flex") {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  resourcesClose?.addEventListener("click", closeDrawer);
  resourcesBackdrop?.addEventListener("click", closeDrawer);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (resourcesDrawer?.style.display === "flex") closeDrawer();
      else handleClose();
    }
  });

  /* ── Generate Visuals (via background to bypass host CSP) ── */
  overlay.addEventListener("click", async (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || !btn.id.startsWith("mindease-gen-visuals-btn")) return;
    if (_contentChunks.length === 0) {
      console.warn("[Content] No chunks available for visual generation");
      btn.textContent = "No content available";
      setTimeout(() => { btn.textContent = "Generate Visuals"; (btn as HTMLButtonElement).disabled = false; }, 2000);
      return;
    }
    btn.textContent = "Generating...";
    (btn as HTMLButtonElement).disabled = true;
    const pendingIds = _contentChunks.slice(0, 5).map(chunk => chunk.id);
    showVisualPlaceholders(pendingIds);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "GENERATE_VISUALS",
        payload: { chunks: _contentChunks.slice(0, 5) },
      })) as { type?: string; visuals?: VisualEntry[]; error?: string } | undefined;
      if (response?.error) throw new Error(response.error);
      const entries: VisualEntry[] = response?.visuals ?? [];
      if (entries.length > 0) {
        renderVisuals(entries);
        btn.textContent = "Generate again";
        (btn as HTMLButtonElement).disabled = false;
      } else {
        btn.textContent = "No visuals generated — try again";
        (btn as HTMLButtonElement).disabled = false;
      }
    } catch (err) {
      console.warn("[Content] Visual generation error:", err);
      btn.textContent = "Failed — try again";
      (btn as HTMLButtonElement).disabled = false;
      finishVisualPlaceholders(pendingIds, err instanceof Error ? err.message : String(err));
    } finally {
      finishVisualPlaceholders(pendingIds);
    }
  });

  /* ── Side toggle ── */
  let onRight = true;
  shadowById("mindease-toggle-side")?.addEventListener("click", () => {
    onRight = !onRight;
    overlay.style.right = onRight ? "0" : "auto";
    overlay.style.left = onRight ? "auto" : "0";
    overlay.style.borderLeft = onRight ? "1px solid var(--border)" : "none";
    overlay.style.borderRight = onRight ? "none" : "1px solid var(--border)";
    overlay.style.boxShadow = onRight ? "var(--shadow)" : "var(--shadow-right)";
    saveSidebarState({ onRight });
  });

  for (const [id, delta] of [["mindease-font-down", -2], ["mindease-font-up", 2]] as const) {
    overlay.querySelector(`#${id}`)?.addEventListener("click", () => {
      const current = parseInt(overlay.style.getPropertyValue("--reader-font-size"), 10) || 16;
      const size = Math.min(32, Math.max(14, current + delta));
      overlay.style.setProperty("--reader-font-size", `${size}px`);
      void browser.storage.local.set({ mindease_reader_font_size: size });
    });
  }
  /* ── TTS: Read aloud / Stop ── */
  /* ── TTS: Read aloud / Stop / Pause ── */
  shadowById("mindease-tts-btn")?.addEventListener("click", () => {
    if (_ttsSpeaking) {
      stopTTS();
    } else if (_ttsTexts.length > 0) {
      speakTexts(_ttsTexts);
    }
  });
  shadowById("mindease-tts-stop")?.addEventListener("click", stopTTS);
  shadowById("mindease-tts-pause")?.addEventListener("click", () => {
    const pauseBtn = shadowById("mindease-tts-pause");
    if (isSpeaking() && !isPaused()) {
      ttsPause();
      if (pauseBtn) pauseBtn.textContent = "▶";
    } else if (isPaused()) {
      ttsResume();
      if (pauseBtn) pauseBtn.textContent = "❚❚";
    }
  });

  overlay.querySelectorAll(".mindease-overlay-speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rate = parseFloat((btn as HTMLElement).dataset.rate || "1.0");
      _ttsOverlayRate = rate;
      saveTtsSettings({ rate });
      overlay.querySelectorAll(".mindease-overlay-speed-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (_ttsSpeaking) {
        if (_ttsActiveChunkIdx !== null) {
          speakSingleChunk(_ttsActiveChunkIdx);
        } else if (_ttsTexts.length > 0) {
          speakTexts(_ttsTexts);
        }
      }
    });
  });

  // Per-chunk speak buttons via event delegation
  overlay.addEventListener("click", (e: MouseEvent) => {
    const target = (e.target as HTMLElement)?.closest(".chunk-speak-btn") as HTMLElement | null;
    if (!target) return;
    const chunkIdxStr = target.dataset.chunkIndex;
    if (chunkIdxStr !== undefined) {
      const chunkIdx = parseInt(chunkIdxStr, 10);
      if (!isNaN(chunkIdx)) {
        speakSingleChunk(chunkIdx);
      }
    }
  });
  /* ── Theme toggle in overlay ── */
  shadowById("mindease-theme-toggle")?.addEventListener("click", () => {
    const next = _theme === "light" ? "dark" : "light";
    _theme = next;
    void saveTheme(next);
    overlay.setAttribute("data-theme", next);
  });

  /* ── Pop out / Full view ── */
  shadowById("mindease-popout")?.addEventListener("click", () => {
    const url = browser.runtime.getURL("src/session/dashboard/dashboard.html");
    window.open(url, "_blank");
  });

  /* ── Restore saved state ── */
  loadSidebarState().then((saved) => {
    if (saved.minimized) {
      minimized = true;
      const body = shadowById("mindease-body");
      const tabs = shadowById("mindease-tabs");
      const stats = shadowById("mindease-stats-bar");
      const footer = shadowById("mindease-footer");
      body!.style.display = "none";
      if (tabs) tabs.style.display = "none";
      if (stats) stats.style.display = "none";
      footer!.style.display = "none";
      overlay.style.height = "auto";
    }
    if (!saved.onRight) {
      onRight = false;
      overlay.style.right = "auto";
      overlay.style.left = "0";
      overlay.style.borderLeft = "none";
      overlay.style.borderRight = "1px solid var(--border)";
      overlay.style.boxShadow = "var(--shadow-right)";
    }

  });

  /* ── Load profile + stats ── */
  Promise.all([
    browser.storage.local.get(["mindease_profile", "mindease_session_stats", "mindease_notes", "latestArtifact"]),
  ]).then(([result]) => {
    const profile = result.mindease_profile as Record<string, unknown> | undefined;
    const stats = result.mindease_session_stats as Record<string, unknown> | undefined;
    const artifact = result.latestArtifact as Record<string, unknown> | undefined;

    // Render aggregated notes
    const notesData = result.mindease_notes as { notes?: Array<Record<string, unknown>> } | undefined;
    renderNotesList(notesData?.notes);

    if (profile) {
      const baseline = profile.baseline as Record<string, unknown> | undefined;
      const rlState = profile.rlState as Record<string, unknown> | undefined;
      const params = profile.transformationParams as Record<string, unknown> | undefined;

      const formatEl = shadowById("pc-format");
      if (formatEl) formatEl.textContent = String(baseline?.formatPreference ?? "-");
      const attentionEl = shadowById("pc-attention");
      if (attentionEl) attentionEl.textContent = String(baseline?.attentionSpan ?? "-");
      const paceEl = shadowById("pc-pace");
      if (paceEl) paceEl.textContent = String(baseline?.readingPace ?? "-");
      const sessionsEl = shadowById("pc-sessions");
      if (sessionsEl) sessionsEl.textContent = String(rlState?.sessionCount ?? 0);

      const chunkMap: Record<string, number> = { small: 25, medium: 50, large: 75 };
      const simplifyMap: Record<string, number> = { "1": 33, "2": 66, "3": 100 };
      const summaryMap: Record<string, number> = { low: 25, medium: 50, high: 75 };

      const chunkBarEl = shadowById("rl-chunk-bar");
      const chunkEl = shadowById("rl-chunk");
      if (chunkBarEl) chunkBarEl.style.width = `${chunkMap[String(params?.chunkSize)] ?? 50}%`;
      if (chunkEl) chunkEl.textContent = String(params?.chunkSize ?? "-");

      const simplifyBarEl = shadowById("rl-simplify-bar");
      const simplifyEl = shadowById("rl-simplify");
      if (simplifyBarEl) simplifyBarEl.style.width = `${simplifyMap[String(params?.simplificationLevel)] ?? 50}%`;
      if (simplifyEl) simplifyEl.textContent = String(params?.simplificationLevel ?? "-");

      const summaryBarEl = shadowById("rl-summary-bar");
      const summaryEl = shadowById("rl-summary");
      if (summaryBarEl) summaryBarEl.style.width = `${summaryMap[String(params?.summaryFrequency)] ?? 50}%`;
      if (summaryEl) summaryEl.textContent = String(params?.summaryFrequency ?? "-");
    }

    if (stats) {
      const hlEl = shadowById("sess-highlights");
      if (hlEl) hlEl.textContent = String(stats.totalHighlights ?? 0);
      const pauseEl = shadowById("sess-pauses");
      if (pauseEl) pauseEl.textContent = String(stats.totalPauses ?? 0);
      const skipEl = shadowById("sess-skips");
      if (skipEl) skipEl.textContent = String(stats.totalSkips ?? 0);
      const rl = profile?.rlState as Record<string, unknown> | undefined;
      const rereadEl = shadowById("sess-rereads");
      if (rereadEl) rereadEl.textContent = String(rl?.reReadRate ?? 0);
      const score = Number(rl?.totalEngagementScore ?? 0);
      const scoreEl = shadowById("sess-score");
      if (scoreEl) scoreEl.textContent = score.toFixed(1);
      const scoreBarEl = shadowById("sess-score-bar");
      if (scoreBarEl) scoreBarEl.style.width = `${Math.min(Math.max(score * 10, 0), 100)}%`;
    }

    // Render focus summary from artifact if available
    if (artifact) {
      const focus = artifact.focusSummary as Record<string, unknown> | undefined;
      if (focus) {
        const durationEl = shadowById("sess-duration");
        if (durationEl) durationEl.textContent = fmtDurationLocal(Number(focus.totalDurationMs ?? 0));
        const focusedEl = shadowById("sess-focused");
        if (focusedEl) focusedEl.textContent = fmtDurationLocal(Number(focus.focusedTimeMs ?? 0));
        const interruptEl = shadowById("sess-interruptions");
        if (interruptEl) interruptEl.textContent = String(focus.interruptionCount ?? 0);
        const longestEl = shadowById("sess-longest");
        if (longestEl) longestEl.textContent = fmtDurationLocal(Number(focus.longestInterruptionMs ?? 0));
      }
      const resources = artifact.resourcesUsed as Array<Record<string, unknown>> | undefined;
      if (resources) {
        const resEl = shadowById("sess-resources");
        if (resEl) resEl.textContent = String(resources.length);
      }
      const cards = artifact.studyCards as Array<Record<string, unknown>> | undefined;
      if (cards) {
        const cardsEl = shadowById("sess-cards");
        if (cardsEl) cardsEl.textContent = String(cards.length);
        const reviewCards = cards.filter(c => c.reviewFlag).length;
        const reviewEl = shadowById("sess-review-cards");
        if (reviewEl) reviewEl.textContent = String(reviewCards);
      }
      const gaps = artifact.needsReview as Array<Record<string, unknown>> | undefined;
      if (gaps) {
        const gapsEl = shadowById("sess-gaps");
        if (gapsEl) gapsEl.textContent = String(gaps.length);
      }
    }
  });

  /* ── Save visible state ── */
  saveSidebarState({
    visible: true,
    minimized: false,
    onRight: true,
    activeTab: "content",
    lastScrollY: window.scrollY,
  });
  _ttsTexts = _contentChunks.map((_, i) => renderedChunkText(i));
  if (baselineProfile.autoReadAloud && _ttsTexts.some(Boolean)) {
    // Narration begins only after the learner has opted in during onboarding.
    speakTexts(_ttsTexts);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Visuals Display
   ═══════════════════════════════════════════════════════════════════════════════ */

let _visualEntries: VisualEntry[] = [];
let _formatPreference: "visual" | "text" = "text";
let _conceptsFromChunks: string[] = [];

/* ── TTS State ──────────────────────────────────────────────────── */
let _ttsSpeaking = false;
let _ttsTexts: string[] = [];
let _ttsActiveChunkIdx: number | null = null;
let _ttsOverlayRate = 1.0;
let _ttsBatchesDone = true;
let _ttsGeneration = 0;
let _ttsLanguage = "en-US";

function stopTTS(): void {
  _ttsGeneration++;
  ttsStop();
  _ttsSpeaking = false;
  _ttsActiveChunkIdx = null;

  shadowQueryAll(".mindease-chunk.tts-active-chunk").forEach((el) => el.classList.remove("tts-active-chunk"));
  shadowQueryAll(".chunk-speak-btn.speaking").forEach((btn) => {
    btn.classList.remove("speaking");
    replaceSanitizedHtml(btn, iconHTML("volume-2"));
  });

  const bar = shadowById("mindease-tts-bar");
  const btn = shadowById("mindease-tts-btn");
  const pauseBtn = shadowById("mindease-tts-pause");
  if (bar) bar.style.display = "none";
  if (btn) replaceSanitizedHtml(btn, iconHTML("volume-2"));
  if (pauseBtn) pauseBtn.textContent = "❚❚";
}

function updateActiveChunkHighlight(chunkIdx: number): void {
  shadowQueryAll(".mindease-chunk").forEach((el, idx) => {
    const attr = el.getAttribute("data-chunk-index");
    const isTarget = attr !== null ? parseInt(attr, 10) === chunkIdx : idx === chunkIdx;
    if (isTarget) {
      el.classList.add("tts-active-chunk");
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const speakBtn = el.querySelector(".chunk-speak-btn");
      if (speakBtn) {
        speakBtn.classList.add("speaking");
        speakBtn.textContent = "■";
      }
    } else {
      el.classList.remove("tts-active-chunk");
      const speakBtn = el.querySelector(".chunk-speak-btn");
      if (speakBtn) {
        speakBtn.classList.remove("speaking");
        replaceSanitizedHtml(speakBtn, iconHTML("volume-2"));
      }
    }
  });
}

function renderedChunkText(chunkIdx: number): string {
  const body = shadowById("tab-content")?.querySelector<HTMLElement>(
    `.mindease-chunk[data-chunk-index="${chunkIdx}"] .chunk-body`,
  );
  return (body?.innerText ?? body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function speakSingleChunk(chunkIdx: number): void {
  if (_ttsSpeaking && _ttsActiveChunkIdx === chunkIdx) {
    stopTTS();
    return;
  }
  stopTTS();

  const chunk = _contentChunks[chunkIdx];
  if (!chunk) return;

  const cleanText = renderedChunkText(chunkIdx);
  if (!cleanText) return;

  _ttsSpeaking = true;
  _ttsActiveChunkIdx = chunkIdx;
  updateActiveChunkHighlight(chunkIdx);

  const bar = shadowById("mindease-tts-bar");
  const btn = shadowById("mindease-tts-btn");
  const pauseBtn = shadowById("mindease-tts-pause");
  if (bar) {
    bar.style.display = "flex";
    const label = bar.querySelector(".tts-label");
    if (label) label.textContent = `Reading section ${chunkIdx + 1}...`;
  }
  if (btn) replaceSanitizedHtml(btn, iconHTML("x") + " Stop");
  if (pauseBtn) pauseBtn.textContent = "❚❚";

  ttsSpeak(cleanText, {
    rate: _ttsOverlayRate,
    voiceLang: _ttsLanguage,
    onEnd: () => {
      stopTTS();
    },
    onError: () => {
      stopTTS();
    },
  }).catch((error) => {
    stopTTS();
    showAdaptationStatus(`Azure narration failed: ${error instanceof Error ? error.message : String(error)}`, true);
  });
}

function speakTexts(texts: string[]): void {
  if (texts.length === 0) return;
  stopTTS();
  _ttsTexts = texts;
  _ttsSpeaking = true;
  _ttsActiveChunkIdx = 0;

  const btn = shadowById("mindease-tts-btn");
  if (btn) replaceSanitizedHtml(btn, iconHTML("x") + " Stop");

  const bar = shadowById("mindease-tts-bar");
  const pauseBtn = shadowById("mindease-tts-pause");
  if (bar) {
    bar.style.display = "flex";
    const label = bar.querySelector(".tts-label");
    if (label) label.textContent = `Reading section 1 of ${texts.length}...`;
  }
  if (pauseBtn) pauseBtn.textContent = "❚❚";

  const generation = _ttsGeneration;
  let i = 0;
  function speakNext(): void {
    if (generation !== _ttsGeneration || !_ttsSpeaking) return;
    if (i >= _ttsTexts.length) {
      if (_ttsBatchesDone) stopTTS();
      else setTimeout(speakNext, 300);
      return;
    }
    _ttsActiveChunkIdx = i;
    updateActiveChunkHighlight(i);

    const b = shadowById("mindease-tts-bar");
    const l = b?.querySelector(".tts-label");
    if (l) l.textContent = `Reading section ${i + 1} of ${_ttsTexts.length}...`;

    ttsSpeak(_ttsTexts[i], {
      rate: _ttsOverlayRate,
      voiceLang: _ttsLanguage,
    }).then(() => {
      i++;
      speakNext();
    }).catch((error) => {
      stopTTS();
      showAdaptationStatus(`Azure narration failed: ${error instanceof Error ? error.message : String(error)}`, true);
    });
  }
  speakNext();
}
let _contentChunks: ContentChunk[] = [];

function showVisualPlaceholders(blockIds: string[]): void {
  for (const id of blockIds) {
    const pending = shadowById(`mindease-pending-${id}`);
    if (pending?.getAttribute("aria-busy") === "true") continue;
    pending?.remove();
    const section = Array.from(shadowQueryAll("#tab-content [data-source-block]"))
      .find(element => element.dataset.sourceBlock === id);
    if (!section) continue;
    const figure = document.createElement("figure");
    figure.id = `mindease-pending-${id}`;
    figure.className = "mindease-inline-visual visual-pending";
    figure.setAttribute("role", "status");
    figure.setAttribute("aria-live", "polite");
    figure.setAttribute("aria-busy", "true");
    replaceSanitizedHtml(figure, '<div class="visual-pending-art" aria-hidden="true"><span></span><span></span><span></span></div><span>Planning and drawing your diagram…</span>');
    section.after(figure);
  }
}

function finishVisualPlaceholders(blockIds: string[], error?: string): void {
  for (const id of blockIds) {
    const figure = shadowById(`mindease-pending-${id}`);
    if (!figure || figure.getAttribute("aria-busy") !== "true") continue;
    figure.setAttribute("aria-busy", "false");
    figure.textContent = error ? `Diagram unavailable: ${error}` : "No diagram was returned for this section.";
  }
}

function openVisualZoom(dataUrl: string, concept: string): void {
  shadowById("mindease-visual-lightbox")?.remove();
  let zoomLevel = 1.0;
  const minZoom = 0.5;
  const maxZoom = 4.0;

  const lightbox = document.createElement("div");
  lightbox.id = "mindease-visual-lightbox";
  lightbox.className = "mindease-lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-label", `Diagram preview: ${concept}`);

  const header = document.createElement("div");
  header.className = "mindease-lightbox-header";

  const titleEl = document.createElement("div");
  titleEl.className = "mindease-lightbox-title";
  titleEl.textContent = concept || "Diagram preview";

  const controls = document.createElement("div");
  controls.className = "mindease-lightbox-controls";

  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.type = "button";
  zoomOutBtn.className = "mindease-lightbox-btn";
  zoomOutBtn.textContent = "− Zoom Out";

  const zoomVal = document.createElement("span");
  zoomVal.className = "mindease-lightbox-zoom-val";
  zoomVal.textContent = "100%";

  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.className = "mindease-lightbox-btn";
  zoomInBtn.textContent = "+ Zoom In";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "mindease-lightbox-btn";
  resetBtn.textContent = "Reset";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "mindease-lightbox-btn";
  closeBtn.setAttribute("aria-label", "Close visual zoom");
  closeBtn.textContent = "× Close";

  controls.append(zoomOutBtn, zoomVal, zoomInBtn, resetBtn, closeBtn);
  header.append(titleEl, controls);

  const body = document.createElement("div");
  body.className = "mindease-lightbox-body";

  const img = document.createElement("img");
  img.className = "mindease-lightbox-img";
  img.src = dataUrl;
  img.alt = concept;

  const applyZoom = () => {
    zoomLevel = Math.max(minZoom, Math.min(maxZoom, zoomLevel));
    img.style.transform = `scale(${zoomLevel})`;
    zoomVal.textContent = `${Math.round(zoomLevel * 100)}%`;
  };

  zoomInBtn.addEventListener("click", () => { zoomLevel += 0.25; applyZoom(); });
  zoomOutBtn.addEventListener("click", () => { zoomLevel -= 0.25; applyZoom(); });
  resetBtn.addEventListener("click", () => { zoomLevel = 1.0; applyZoom(); });

  const close = () => {
    document.removeEventListener("keydown", onKey);
    lightbox.remove();
  };
  closeBtn.addEventListener("click", close);
  body.addEventListener("click", (e) => {
    if (e.target === body) close();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "+" || e.key === "=") { zoomLevel += 0.25; applyZoom(); }
    else if (e.key === "-") { zoomLevel -= 0.25; applyZoom(); }
    else if (e.key === "0") { zoomLevel = 1.0; applyZoom(); }
  };
  document.addEventListener("keydown", onKey);

  body.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    zoomLevel += delta;
    applyZoom();
  }, { passive: false });

  img.addEventListener("dblclick", () => {
    zoomLevel = zoomLevel > 1.2 ? 1.0 : 2.0;
    applyZoom();
  });

  body.append(img);
  lightbox.append(header, body);
  appendToShadow(lightbox);
}

function renderVisuals(visuals: VisualEntry[]): void {
  const entries = new Map(_visualEntries.map(entry => [entry.id, entry]));
  for (const visual of visuals) entries.set(visual.id, visual);
  _visualEntries = [...entries.values()];
  const grid = shadowById("mindease-visuals-grid");
  if (!grid) return;
  for (const visual of visuals) {
    if (shadowById(`mindease-visual-${visual.id}`)) continue;
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(visual.dataUrl)) continue;
    if (visual.sourceBlockId) shadowById(`mindease-pending-${visual.sourceBlockId}`)?.remove();
    const figure = document.createElement("figure");
    figure.id = `mindease-visual-${visual.id}`;
    figure.className = "mindease-inline-visual";
    const wrap = document.createElement("div");
    wrap.className = "mindease-visual-img-wrap";
    const image = document.createElement("img");
    image.src = visual.dataUrl; image.alt = visual.concept;
    image.title = "Click to zoom picture";
    image.addEventListener("click", () => openVisualZoom(visual.dataUrl, visual.concept));
    const zoomBtn = document.createElement("button");
    zoomBtn.type = "button";
    zoomBtn.className = "mindease-visual-zoom-btn";
    zoomBtn.setAttribute("aria-label", `Zoom picture: ${visual.concept}`);
    replaceSanitizedHtml(zoomBtn, `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg><span>Zoom</span>`);
    zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openVisualZoom(visual.dataUrl, visual.concept);
    });
    wrap.append(image, zoomBtn);
    const caption = document.createElement("figcaption"); caption.textContent = visual.concept;
    figure.append(wrap, caption);
    const section = Array.from(shadowQueryAll("#tab-content [data-source-block]"))
      .find(element => element.dataset.sourceBlock === visual.sourceBlockId);
    if (section) section.after(figure); else if (!visual.sourceBlockId) grid.append(figure);
  }
}

async function initYouTubeMode(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 3000));
  if (!_extensionActive) return;

  const video = document.querySelector("video") as HTMLVideoElement;
  if (!video) return;

  const captionOverlay = document.createElement("div");
  captionOverlay.id = "mindease-caption-overlay";
  captionOverlay.setAttribute("aria-live", "polite");
  captionOverlay.setAttribute("aria-label", "AI-transformed captions");

  const baseBg = _theme === "light" ? "rgba(212, 212, 212, 0.95)" : "rgba(23, 23, 23, 0.94)";
  const baseText = _theme === "light" ? "#171717" : "#d4d4d4";
  const accentColor = baseText;

  captionOverlay.style.cssText = `
    position: fixed;
    bottom: 120px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 800px;
    width: 90%;
    background: ${baseBg};
    color: ${baseText};
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    font-size: 1.125rem;
    line-height: 1.6;
    letter-spacing: 0.04em;
    padding: 12px 20px;
    border-radius: 12px;
    border: 1px solid ${accentColor};
    z-index: 2147483645;
    text-align: center;
    backdrop-filter: blur(8px);
    display: none;
    box-shadow: 0 4px 24px rgba(23, 23, 23, 0.2);
  `;
  appendToShadow(captionOverlay);

  const pageText = document.querySelector("#description")?.textContent?.slice(0, 2000)
    ?? document.title + " - YouTube video";

  const accepted = await requestAndSendTransformation(pageText, "video");
  if (!accepted) {
    captionOverlay.remove();
    return;
  }

  let captionChunks: string[] = [];

  const captionMessageHandler = (message: unknown) => {
    const msg = message as { type: string; chunks?: Array<{ text: string }> };
    if (msg.type === "TRANSFORMED_CONTENT" && msg.chunks) {
      captionChunks = msg.chunks.map(c => c.text);
    }
  };
  browser.runtime.onMessage.addListener(captionMessageHandler);

  const onTimeUpdate = () => {
    if (captionChunks.length === 0) return;
    const progress = video.currentTime / (video.duration || 1);
    const index = Math.floor(progress * captionChunks.length);
    const caption = captionChunks[Math.min(index, captionChunks.length - 1)];
    if (caption) {
      captionOverlay.style.display = "block";
      captionOverlay.textContent = caption;
    }
  };
  const onPause = () => { captionOverlay.style.display = "none"; };
  const onPlay = () => { if (captionChunks.length > 0) captionOverlay.style.display = "block"; };

  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("pause", onPause);
  video.addEventListener("play", onPlay);

  _cleanupVideo = () => {
    browser.runtime.onMessage.removeListener(captionMessageHandler);
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("play", onPlay);
    captionOverlay.remove();
  };
}

async function initGenericVideoMode(video: HTMLVideoElement, platform: string): Promise<void> {
  if (!_extensionActive) return;
  _cleanupVideo?.();
  const controller = new AbortController();
  _cleanupVideo = () => controller.abort();
  const transcript = await loadTextTrackTranscript(video, controller.signal);
  if (controller.signal.aborted || !_extensionActive) return;
  if (!transcript || transcript.cues.length === 0) {
    const platformLabel = platform === "vimeo" ? "Vimeo" : "this video player";
    showAdaptationStatus(
      `MindEase detected a video on ${platformLabel}, but no active captions or text tracks are readable. Enable subtitles on the player to allow adaptation.`,
      true,
    );
    return;
  }
  const text = transcriptToText(transcript);
  if (text.trim().length < 30) {
    showAdaptationStatus("MindEase found captions, but there was not enough readable dialogue.", true);
    return;
  }
  const captionOverlay = document.createElement("div");
  captionOverlay.id = "mindease-caption-overlay";
  captionOverlay.setAttribute("aria-live", "polite");
  captionOverlay.setAttribute("aria-label", "AI-transformed captions");
  const baseBg = _theme === "light" ? "rgba(212, 212, 212, 0.95)" : "rgba(23, 23, 23, 0.94)";
  const baseText = _theme === "light" ? "#171717" : "#d4d4d4";
  captionOverlay.style.cssText = `
    position: fixed;
    bottom: 120px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 800px;
    width: 90%;
    background: ${baseBg};
    color: ${baseText};
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    font-size: 1.125rem;
    line-height: 1.6;
    letter-spacing: 0.04em;
    padding: 12px 20px;
    border-radius: 12px;
    border: 1px solid ${baseText};
    z-index: 2147483645;
    text-align: center;
    backdrop-filter: blur(8px);
    display: none;
    box-shadow: 0 4px 24px rgba(23, 23, 23, 0.2);
  `;
  appendToShadow(captionOverlay);
  const accepted = await requestAndSendTransformation(text, "video");
  if (!accepted || controller.signal.aborted || !_extensionActive) {
    captionOverlay.remove();
    return;
  }
  let captionChunks: string[] = [];
  const captionMessageHandler = (message: unknown) => {
    const msg = message as { type: string; chunks?: Array<{ text: string }> };
    if (msg.type === "TRANSFORMED_CONTENT" && msg.chunks) {
      captionChunks = msg.chunks.map(c => c.text);
    }
  };
  browser.runtime.onMessage.addListener(captionMessageHandler);
  const onTimeUpdate = () => {
    if (captionChunks.length === 0) return;
    const progress = video.currentTime / (video.duration || 1);
    const index = Math.floor(progress * captionChunks.length);
    const caption = captionChunks[Math.min(index, captionChunks.length - 1)];
    if (caption) {
      captionOverlay.style.display = "block";
      captionOverlay.textContent = caption;
    }
  };
  const onPause = () => { captionOverlay.style.display = "none"; };
  const onPlay = () => { if (captionChunks.length > 0) captionOverlay.style.display = "block"; };
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("pause", onPause);
  video.addEventListener("play", onPlay);
  _cleanupVideo = () => {
    browser.runtime.onMessage.removeListener(captionMessageHandler);
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("play", onPlay);
    captionOverlay.remove();
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PDF Mode
   ═══════════════════════════════════════════════════════════════════════════════ */

async function initPDFMode(): Promise<void> {
  if (isNativePdfViewer(document)) {
    showAdaptationStatus(
      "Browser built-in PDF viewer prevents in-page script injection. Use the 'Read PDF' action in the MindEase popup to adapt this document.",
      true,
    );
    return;
  }
  const pdfText = window.location.href;
  const loader = document.createElement("div");
  loader.id = "mindease-pdf-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");

  const accentColor = _theme === "light" ? "#171717" : "#d4d4d4";
  const baseBg = _theme === "light" ? "#d4d4d4" : "#171717";

  loader.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${baseBg};
    color: ${accentColor};
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    font-size: 0.8125rem;
    padding: 10px 16px;
    border-radius: 8px;
    border: 1px solid ${accentColor};
    z-index: 2147483644;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  `;
  const accepted = await requestAndSendTransformation(pdfText, "pdf");
  if (!accepted) return;
  replaceSanitizedHtml(loader, `<span style="display:inline-flex;animation:mindease-spin 1s linear infinite">${iconHTML("refresh-cw")}</span> MindEase &mdash; Structuring PDF...`);
  document.body?.appendChild(loader);

  setTimeout(() => loader?.remove(), 30000);
}
