/* ============================================================
   content/index.ts - Content Script
   Runs inside every webpage the student visits.
   Detects content type, tracks behavioral signals for Layer 2,
   and activates the appropriate layer.
   ============================================================ */

import browser from "webextension-polyfill";
import type { ContentChunk, VisualEntry, QTable, BaselineProfile, TransformationParams } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { initTheme, applyTheme, type Theme } from "@/utils/themeManager";
import { iconHTML } from "@/utils/icons";
import { renderLatex } from "@/utils/latex";
import {
  saveSidebarState,
  loadSidebarState,
  injectReopenButton,
  removeReopenButton,
  ensureReopenStyles,
  type SidebarState,
} from "@/content/sidebarManager";
import { showDiscoveryPrompt } from "@/content/discoveryPrompt";

interface ActivationResult {
  decision: boolean;
  ambiguous: boolean;
}

function shouldActivate(): ActivationResult {
  const { hostname, href: url } = window.location;
  const title = document.title;

  const neverEducational = [
    "netflix.com", "twitch.tv", "discord.com", "whatsapp.com",
    "snapchat.com",
  ];
  if (neverEducational.some(d => hostname.includes(d))) return { decision: false, ambiguous: false };

  // Asset & search sites — not study content, show discovery prompt instead
  const promptOnlyHosts = [
    "unsplash.com", "pexels.com", "pixabay.com", "gettyimages.com",
    "shutterstock.com", "istockphoto.com", "imgur.com",
    "flaticon.com", "icons8.com", "iconfinder.com", "fontawesome.com",
    "fonts.google.com", "dafont.com",
    "freepik.com", "vecteezy.com", "storyset.com",
    "duckduckgo.com",
  ];
  if (promptOnlyHosts.some(d => hostname.includes(d))) return { decision: false, ambiguous: false };
  // Search engine result pages (check URL path, not just hostname)
  if (/google\.\w{2,4}\/search/.test(url) || /bing\.com\/search/.test(url) || /search\.yahoo\.com/.test(url)) {
    return { decision: false, ambiguous: false };
  }

  if (url.endsWith(".pdf") || document.contentType === "application/pdf") return { decision: true, ambiguous: false };

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
  const url = window.location.href;

  if (url.endsWith(".pdf") || document.contentType === "application/pdf") {
    return "pdf";
  }
  if (
    url.includes("youtube.com/watch") ||
    url.includes("vimeo.com") ||
    document.querySelector("video") !== null
  ) {
    return "video";
  }
  return "website";
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
let _cleanupYouTube: (() => void) | null = null;

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
function onExtensionStateChange(active: boolean): void {
  _extensionActive = active;
  if (!active) {
    destroyBehaviorTracking();
    document.getElementById("mindease-overlay")?.remove();
    document.getElementById("mindease-pdf-loader")?.remove();
    removeReopenButton();
    _cleanupYouTube?.();
    _cleanupYouTube = null;
    stopQTablePolling();
  } else {
    const { decision, ambiguous } = shouldActivate();
    if (!decision) return;
    const sourceType = detectSourceType();
    if (!sourceType) return;
    if (ambiguous) {
      requestLLMClassification(sourceType);
    } else {
      activateForSession(sourceType);
    }
    startQTablePolling();
  }
}

function requestLLMClassification(sourceType: string): void {
  browser.runtime.sendMessage({
    type: "CLASSIFY_CONTENT",
    payload: {
      title: document.title,
      snippet: document.body.innerText.slice(0, 1500),
    },
  }).catch(() => {});
  const handler = (message: unknown) => {
    const msg = message as { type: string; payload?: { classification: string } };
    if (msg.type === "CLASSIFY_CONTENT_RESULT") {
      browser.runtime.onMessage.removeListener(handler);
      if (msg.payload?.classification === "educational" && _extensionActive) {
        const sourceType = detectSourceType();
        if (sourceType) {
          activateForSession(sourceType);
          startQTablePolling();
        }
      }
    }
  };
  browser.runtime.onMessage.addListener(handler);
}

async function activateForSession(sourceType: string): Promise<void> {
  console.log(`[MindEase Content] Activating for ${sourceType}`);

  browser.runtime.sendMessage({
    type: "SESSION_START",
    payload: {
      sourceType,
      url: window.location.href,
      timestamp: Date.now(),
      title: document.title,
    },
  });

  initBehaviorTracking();
  triggerContentTransformation(sourceType);

  const savedState = await loadSidebarState();
  if (savedState.visible) {
    return;
  }
  ensureReopenStyles();
  const btn = injectReopenButton(_theme);
  btn.addEventListener("click", async () => {
    removeReopenButton();
    await saveSidebarState({ visible: true });
    const text = document.body.innerText.slice(0, 4000);
    if (text.trim().length >= 50) {
      browser.runtime.sendMessage({
        type: "TRANSFORM_CONTENT",
        payload: { text, pageType: "website" },
      }).catch(() => {});
    }
  });
}

async function triggerContentTransformation(sourceType: string): Promise<void> {
  await wakeServiceWorker();
  if (sourceType === "video") {
    const video = document.querySelector("video") as HTMLVideoElement;
    if (video && !video.paused) {
      await initYouTubeMode();
    } else if (video) {
      video.addEventListener("play", () => initYouTubeMode(), { once: true });
    }
  } else if (sourceType === "pdf") {
    await initPDFMode();
  } else {
    if (document.visibilityState === "visible") {
      setTimeout(() => initContentTransformation(sourceType), 2000);
    } else {
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVisible);
          setTimeout(() => initContentTransformation(sourceType), 2000);
        }
      };
      document.addEventListener("visibilitychange", onVisible);
    }
  }
}

(async () => {
  _theme = await initTheme();

  // Always listen for state changes — handles tabs opened during a session too
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type: string; active?: boolean };
    if (msg.type === "EXTENSION_STATE_CHANGED") {
      onExtensionStateChange(msg.active ?? false);
    }
  });

  if (!shouldActivate().decision) {
    showDiscoveryPrompt(_theme, () => {
      _extensionActive = true;
      browser.runtime.sendMessage({
        type: "SESSION_START",
        payload: {
          sourceType: "website",
          url: window.location.href,
          timestamp: Date.now(),
          title: document.title,
        },
      });
      triggerContentTransformation("website");
    });
    return;
  }

  _extensionActive = await isExtensionActive();
  if (!_extensionActive) {
    console.log("[MindEase] Extension is inactive. Waiting for user to start a session.");
    return;
  }

  const sourceType = detectSourceType();
  if (!sourceType) return;
  await activateForSession(sourceType);
  startQTablePolling();
})();

/* ─── Layer 1: Content Transformation ──────────────────────────────────────────── */

function initContentTransformation(pageType: string): void {
  try {
    const text = document.body.innerText.slice(0, 4000);
    if (text.trim().length < 50) return;
    browser.runtime.sendMessage({
      type: "TRANSFORM_CONTENT",
      payload: { text, pageType },
    }).catch(() => {});
  } catch (err) {
    console.error("[MindEase] Transform send error:", err);
  }
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
  const container = document.getElementById("mindease-notes-list");
  if (!container) return;
  if (!notes || notes.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.78rem;text-align:center;padding:12px">Highlight text on the page to create notes.</p>';
    return;
  }
  const recent = notes.slice(-20).reverse();
  container.innerHTML = recent.map((n) => `
    <div class="mindease-note-card">
      <div class="mindease-note-text">\u201C${renderLatex(_escHtml(String(n.text ?? "")))}\u201D</div>
      <div class="mindease-note-meta">
        <span class="mindease-note-source">${_escHtml(_trunc(String(n.resourceTitle ?? n.sourceUrl ?? ""), 40))}</span>
        <span>${new Date(Number(n.timestamp ?? 0)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  `).join("");
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
    append?: boolean; done?: boolean;
  };
  if (msg.type === "TRANSFORMED_CONTENT" && msg.chunks && msg.chunks.length > 0) {
    if (!_extensionActive) return;
    removeReopenButton();
    if (msg.append) {
      appendToOverlay(msg.chunks);
    } else {
      injectOverlay(msg.chunks, msg.baseline, msg.transformationParams);
    }
    if (msg.done) {
      const marker = document.getElementById("mindease-loading-marker");
      if (marker) marker.style.display = "none";
    }
  }
  if (msg.type === "VISUALS_READY" && msg.visuals) {
    renderVisuals(msg.visuals);
  }
  if (msg.type === "TRANSFORM_ERROR") {
    console.error("[MindEase Content] Transform error:", msg.error);
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
});

/* ═══════════════════════════════════════════════════════════════════════════════
   Overlay Styles - Injected CSS string with theme variables
   ═══════════════════════════════════════════════════════════════════════════════ */

const OVERLAY_CSS = `
      /* ── Theme variables (scoped to overlay) ── */
      #mindease-overlay[data-theme="dark"] {
        --bg-base:        #1A1D3A;
        --bg-surface:     #252A55;
        --bg-surface-alt: #20254A;
        --bg-elevated:    #2E3366;
        --bg-overlay:     rgba(26, 29, 58, 0.95);
        --border:         #7286D3;
        --border-hover:   #8EA7E9;
        --border-focus:   #8EA7E9;
        --text-primary:   #E5E0FF;
        --text-dim:       #B8B8E0;
        --text-muted:     #8A8AB8;
        --accent:         #8EA7E9;
        --accent-secondary: #E5E0FF;
        --accent-gradient:  linear-gradient(135deg, #8EA7E9, #E5E0FF);
        --accent-glow:      rgba(142,167,233,0.25);
        --danger:         #f87171;
        --success:        #4ade80;
        --warning:        #facc15;
        --shadow:         -8px 0 48px rgba(0,0,0,0.6);
        --shadow-right:   8px 0 48px rgba(0,0,0,0.6);
        --font-family:    'Inter', system-ui, -apple-system, sans-serif;
      }

      #mindease-overlay[data-theme="light"] {
        --bg-base:        #FFF2C6;
        --bg-surface:     #FFF8DE;
        --bg-surface-alt: #FFFBE8;
        --bg-elevated:    #FFFAE8;
        --bg-overlay:     rgba(255, 242, 198, 0.97);
        --border:         #AAC4F5;
        --border-hover:   #8CA9FF;
        --border-focus:   #8CA9FF;
        --text-primary:   #2D2B55;
        --text-dim:       #6E7FA8;
        --text-muted:     #94A8CC;
        --accent:         #8CA9FF;
        --accent-secondary: #AAC4F5;
        --accent-gradient:  linear-gradient(135deg, #8CA9FF, #AAC4F5);
        --accent-glow:      rgba(140,169,255,0.20);
        --danger:         #dc2626;
        --success:        #16a34a;
        --warning:        #ca8a04;
        --shadow:         -8px 0 48px rgba(0,0,0,0.1);
        --shadow-right:   8px 0 48px rgba(0,0,0,0.1);
        --font-family:    'Inter', system-ui, -apple-system, sans-serif;
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
        padding: 16px 20px;
        background: var(--bg-surface);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      #mindease-logo {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #mindease-logo .logo-icon {
        width: 28px; height: 28px;
        background: var(--accent-gradient);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        flex-shrink: 0;
      }
      #mindease-logo .logo-text {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--text-primary);
        letter-spacing: 0.05em;
      }
      #mindease-logo .logo-badge {
        font-size: 0.6rem;
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
        letter-spacing: 0.05em;
      }

      /* ── Controls ── */
      #mindease-controls {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .mindease-ctrl-btn {
        background: none;
        border: 1px solid var(--border);
        color: var(--text-dim);
        width: 28px; height: 28px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .mindease-ctrl-btn:hover { color: var(--text-primary); border-color: var(--border-hover); }
      .mindease-ctrl-btn:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
      }
      #mindease-close:hover { color: var(--danger); border-color: var(--danger); }

      /* ── Tabs ── */
      #mindease-tabs {
        display: flex;
        background: var(--bg-surface);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .mindease-tab {
        flex: 1;
        padding: 10px 8px;
        font-size: 0.72rem;
        font-weight: 500;
        color: var(--text-dim);
        text-align: center;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.15s;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        background: none;
      }
      .mindease-tab:hover { color: var(--text-primary); }
      .mindease-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
      .mindease-tab:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }

      /* ── Stats bar ── */
      #mindease-stats-bar {
        display: flex;
        gap: 0;
        background: var(--bg-surface-alt);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .mindease-stat {
        flex: 1;
        padding: 8px 4px;
        text-align: center;
        border-right: 1px solid var(--border);
      }
      .mindease-stat:last-child { border-right: none; }
      .mindease-stat .s-num {
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--text-primary);
        display: block;
      }
      .mindease-stat .s-label {
        font-size: 0.58rem;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
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
        margin-bottom: 12px;
        padding: 14px;
        background: var(--bg-surface);
        border-radius: 10px;
        border: 1px solid var(--border);
        transition: border-color 0.15s;
        animation: mindease-fadeUp 0.3s ease both;
      }
      .mindease-chunk:hover { border-color: var(--border-hover); }
      .mindease-chunk.has-concept {
        border-color: color-mix(in srgb, var(--accent) 20%, transparent);
        background: linear-gradient(135deg, var(--bg-surface), var(--bg-elevated));
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
        --chunk-theme: #10b981;
        --chunk-bg: color-mix(in srgb, #10b981 6%, var(--bg-surface));
      }
      .mindease-chunk.color-quaternary {
        --chunk-theme: #f59e0b;
        --chunk-bg: color-mix(in srgb, #f59e0b 6%, var(--bg-surface));
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
      .color-tertiary .chunk-concept-tag { color: #10b981; background: color-mix(in srgb, #10b981 12%, transparent); }
      .color-quaternary .chunk-concept-tag { color: #f59e0b; background: color-mix(in srgb, #f59e0b 12%, transparent); }

      .color-accent .chunk-body h4.chunk-subtitle { color: var(--accent); }
      .color-secondary .chunk-body h4.chunk-subtitle { color: var(--accent-secondary); }
      .color-tertiary .chunk-body h4.chunk-subtitle { color: #10b981; }
      .color-quaternary .chunk-body h4.chunk-subtitle { color: #f59e0b; }

      .color-accent .chunk-body blockquote { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
      .color-secondary .chunk-body blockquote { border-left-color: var(--accent-secondary); background: color-mix(in srgb, var(--accent-secondary) 6%, transparent); }
      .color-tertiary .chunk-body blockquote { border-left-color: #10b981; background: color-mix(in srgb, #10b981 6%, transparent); }
      .color-quaternary .chunk-body blockquote { border-left-color: #f59e0b; background: color-mix(in srgb, #f59e0b 6%, transparent); }

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
      .visual-card-img {
        width: 100%;
        display: block;
        background: var(--bg-base);
        object-fit: contain;
      }
      .visual-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        font-size: 0.72rem;
        color: var(--text-dim);
        border-top: 1px solid var(--border);
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
      .visual-card-source.flux {
        background: color-mix(in srgb, #f59e0b 15%, transparent);
        color: #fbbf24;
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
      @media (max-width: 480px) {
        #mindease-overlay {
          width: 100vw !important;
          border-left: none !important;
          border-right: none !important;
        }
        #mindease-header { padding: 12px 14px; }
        #mindease-body { padding: 12px; }
        .profile-grid { grid-template-columns: 1fr; }
        #mindease-logo .logo-badge { display: none; }
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

      /* ── Adaptive: Formula ── */
      .m-formula {
        display: inline-block;
        padding: 4px 8px;
        background: var(--bg-surface-alt);
        border: 1px solid var(--border);
        border-radius: 6px;
        font-size: 1rem;
        margin: 4px 0;
        overflow-x: auto;
      }

      /* ── Adaptive: Slow pace - larger text ── */
      #mindease-overlay[data-pace="slow"] .chunk-body {
        font-size: 1rem;
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
`;

/* ═══════════════════════════════════════════════════════════════════════════════
   Overlay helpers (module-level for reuse in appendToOverlay)
   ═══════════════════════════════════════════════════════════════════════════════ */

function formatChunkText(raw: string): string {
  const withDefs = raw.replace(
    /\[DEF:\s*([^\]]+)\]/gi,
    (_, term) =>
      `<span class="m-def-term" data-def="${_escHtml(term.trim())}">${_escHtml(term.trim())}</span>`,
  );
  const withFormulas = withDefs.replace(
    /\[FORMULA\]([\s\S]*?)\[\/FORMULA\]/gi,
    (_, formula) => `<span class="m-formula">${renderLatex(formula.trim())}</span>`,
  );
  const lines = withFormulas.split("\n").filter(l => l.trim());
  const parts: string[] = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^>\s/.test(trimmed)) {
      if (inList) { parts.push("</ul>"); inList = false; }
      parts.push(`<blockquote>${trimmed.replace(/^>\s*/, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</blockquote>`);
    } else if (/^[-*]\s/.test(trimmed)) {
      if (!inList) { parts.push("<ul>"); inList = true; }
      parts.push(`<li>${trimmed.replace(/^[-*]\s*/, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`);
    } else if (/^\*\*(.+?)\*\*:?\s*/.test(trimmed)) {
      if (inList) { parts.push("</ul>"); inList = false; }
      parts.push(`<h4 class="chunk-subtitle">${trimmed.replace(/\*\*(.+?)\*\*/g, "$1")}</h4>`);
    } else {
      if (inList) { parts.push("</ul>"); inList = false; }
      const formatted = trimmed
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
      parts.push(`<p>${formatted}</p>`);
    }
  }
  if (inList) parts.push("</ul>");
  return renderLatex(parts.join("\n"));
}

function stripInlineTags(text: string): string {
  return text
    .replace(/\[CONCEPT:[^\]]+\]/g, "")
    .replace(/\[SUMMARY:[^\]]+\]/g, "")
    .replace(/\[CHUNK\s*\d*\]/gi, "")
    .replace(/^---+$/gm, "")
    .trim();
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Floating Overlay Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function appendToOverlay(chunks: ContentChunk[]): void {
  const container = document.getElementById("tab-content");
  const marker = document.getElementById("mindease-loading-marker");
  if (!container) return;
  const palette = ["accent", "secondary", "tertiary", "quaternary"];
  const existing = container.querySelectorAll(".mindease-chunk").length;
  const html = chunks.map((chunk, i) => {
    const concept = chunk.conceptTags[0] ?? "";
    const cleanText = chunk.text
      .replace(/\[CONCEPT:[^\]]+\]/g, "")
      .replace(/\[SUMMARY:[^\]]+\]/g, "")
      .replace(/\[CHUNK\s*\d*\]/gi, "")
      .replace(/^---+$/gm, "")
      .trim();
    const bodyHTML = formatChunkText(cleanText);
    const colorKey = palette[(existing + i) % palette.length];
    return `
      <div class="mindease-chunk ${concept ? "has-concept" : ""} color-${colorKey}
           ${chunk.isExample ? "is-example" : ""} ${chunk.hasDefinitions ? "has-defs" : ""}">
        ${concept ? `<div class="chunk-concept-tag">${iconHTML("star")} ${_escHtml(concept)}</div>` : ""}
        <div class="chunk-body">${bodyHTML}</div>
        ${chunk.summary ? `<div class="chunk-summary">${iconHTML("arrow-right")} ${_escHtml(chunk.summary)}</div>` : ""}
      </div>
    `;
  }).join("");
  if (marker) {
    marker.insertAdjacentHTML("beforebegin", html);
  } else {
    container.insertAdjacentHTML("beforeend", html);
  }
  const statEl = document.getElementById("mindease-engage-count");
  if (statEl) {
    const total = container.querySelectorAll(".mindease-chunk").length;
    statEl.textContent = String(total);
  }
}

function injectOverlay(
  chunks: ContentChunk[],
  baseline?: BaselineProfile,
  transformationParams?: TransformationParams,
): void {
  document.getElementById("mindease-overlay")?.remove();
  document.getElementById("mindease-pdf-loader")?.remove();
  removeReopenButton();

  const tParams = transformationParams ?? chunkParams;
  const baselineProfile = baseline ?? defaultBaseline;

  function renderChunkHTML(chunk: ContentChunk, i: number): string {
    const concept = chunk.conceptTags[0] ?? "";
    const summary = chunk.summary ?? "";
    const cleanText = stripInlineTags(chunk.text);
    const palette = ["accent", "secondary", "tertiary", "quaternary"];
    const colorKey = palette[i % palette.length];
    const bodyHTML = formatChunkText(cleanText);

    return `
      <div class="mindease-chunk ${concept ? "has-concept" : ""} color-${colorKey}
           ${chunk.isExample ? "is-example" : ""} ${chunk.hasDefinitions ? "has-defs" : ""}"
           data-chunk-index="${i}">
        ${concept ? `<div class="chunk-concept-tag">${iconHTML("star")} ${_escHtml(concept)}</div>` : ""}
        <div class="chunk-body">${bodyHTML}</div>
        ${summary ? `<div class="chunk-summary">${iconHTML("arrow-right")} ${_escHtml(summary)}</div>` : ""}
      </div>
    `;
  }

  let orderedChunks = [...chunks];

  if (baselineProfile.learningApproach === "example-first") {
    const examples = orderedChunks.filter(c => c.isExample);
    const rest = orderedChunks.filter(c => !c.isExample);
    orderedChunks = [...examples, ...rest];
  } else {
    const theory = orderedChunks.filter(c => !c.isExample);
    const examples = orderedChunks.filter(c => c.isExample);
    orderedChunks = [...theory, ...examples];
  }

  const totalConcepts = orderedChunks.reduce((acc, c) => acc + c.conceptTags.length, 0);
  const summaryCount = orderedChunks.filter(c => c.summary).length;

  const infoDensity = baselineProfile.infoDensity;
  const secondLang = baselineProfile.secondLanguageLearner;
  const readingPace = baselineProfile.readingPace;
  const attentionSpan = baselineProfile.attentionSpan;

  const overlay = document.createElement("div");
  overlay.id = "mindease-overlay";
  overlay.setAttribute("data-theme", _theme);
  overlay.setAttribute("data-attention", attentionSpan);
  overlay.setAttribute("data-pace", readingPace);
  overlay.setAttribute("data-density", infoDensity);
  overlay.setAttribute("data-second-lang", String(secondLang));
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "MindEase study panel");
  overlay.setAttribute("aria-hidden", "false");

  if (!document.getElementById("mindease-katex-css")) {
    const link = document.createElement("link");
    link.id = "mindease-katex-css";
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    document.head.appendChild(link);
  }

  if (!document.getElementById("mindease-overlay-styles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "mindease-overlay-styles";
    styleEl.textContent = OVERLAY_CSS;
    document.head.appendChild(styleEl);
  }

  overlay.innerHTML = `
    <div id="mindease-header">
      <div id="mindease-logo">
        <div class="logo-icon">${iconHTML("brain")}</div>
        <span class="logo-text">MindEase</span>
        <span class="logo-badge">ADAPTIVE</span>
      </div>
      <div id="mindease-controls">
        <button class="mindease-ctrl-btn" id="mindease-theme-toggle" title="Toggle theme" aria-label="Toggle theme">${_theme === "light" ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'}</button>
        <button class="mindease-ctrl-btn" id="mindease-minimize" title="Minimize" aria-label="Minimize panel">&minus;</button>
        <button class="mindease-ctrl-btn" id="mindease-close" title="Close" aria-label="Close panel">${iconHTML("x")}</button>
      </div>
    </div>

    <div id="mindease-tabs" role="tablist" aria-label="Panel sections">
      <button class="mindease-tab active" data-tab="content" role="tab" aria-selected="true" aria-controls="tab-content">Content</button>
      <button class="mindease-tab" data-tab="visuals" role="tab" aria-selected="false" aria-controls="tab-visuals">Visuals <span class="visuals-badge" id="visuals-badge" style="display:none">0</span></button>
      <button class="mindease-tab" data-tab="profile" role="tab" aria-selected="false" aria-controls="tab-profile">Profile</button>
      <button class="mindease-tab" data-tab="session" role="tab" aria-selected="false" aria-controls="tab-session">Session</button>
    </div>

    <div id="mindease-stats-bar">
      <div class="mindease-stat">
        <span class="s-num">${orderedChunks.length}</span>
        <span class="s-label">Chunks</span>
      </div>
      <div class="mindease-stat">
        <span class="s-num">${totalConcepts}</span>
        <span class="s-label">Concepts</span>
      </div>
      <div class="mindease-stat">
        <span class="s-num">${summaryCount}</span>
        <span class="s-label">Summaries</span>
      </div>
      <div class="mindease-stat">
        <span class="s-num" id="mindease-engage-count">0</span>
        <span class="s-label">Engaged</span>
      </div>
    </div>

    <div id="mindease-body">
      <div class="mindease-tab-content active" id="tab-content" role="tabpanel" aria-label="Content">
        ${orderedChunks.length === 0
          ? '<p style="color:var(--text-muted);text-align:center;padding:24px">No content chunks yet.</p>'
          : orderedChunks.map((chunk, ci) => renderChunkHTML(chunk, ci)).join("")
        }
        <div id="mindease-loading-marker" style="display:none;text-align:center;padding:16px;color:var(--text-muted);font-size:0.78rem">
          ${iconHTML("loader")} Loading more content...
        </div>
      </div>

      <div class="mindease-tab-content" id="tab-visuals" role="tabpanel" aria-label="Visuals" style="display:none">
        <div class="mindease-section-title">Generated Visuals</div>
        <div id="mindease-visuals-grid" class="visuals-grid">
          <p class="visuals-placeholder">Visuals will appear here when generated.</p>
        </div>
      </div>

      <div class="mindease-tab-content" id="tab-profile" role="tabpanel" aria-label="Profile">
        <div class="mindease-section-title">Cognitive Baseline</div>
        <div class="profile-grid" id="mindease-profile-grid">
          <div class="profile-card">
            <div class="pc-label">Format</div>
            <div class="pc-value" id="pc-format">&mdash;</div>
          </div>
          <div class="profile-card">
            <div class="pc-label">Attention</div>
            <div class="pc-value" id="pc-attention">&mdash;</div>
          </div>
          <div class="profile-card">
            <div class="pc-label">Reading Pace</div>
            <div class="pc-value" id="pc-pace">&mdash;</div>
          </div>
          <div class="profile-card">
            <div class="pc-label">Sessions</div>
            <div class="pc-value" id="pc-sessions">&mdash;</div>
          </div>
        </div>
        <div class="mindease-section-title">RL Adaptation</div>
        <div id="mindease-rl-bars">
          <div class="rl-bar-container">
            <div class="rl-bar-label"><span>Chunk Size</span><span id="rl-chunk">&mdash;</span></div>
            <div class="rl-bar"><div class="rl-bar-fill" id="rl-chunk-bar" style="width:50%;background:var(--accent)"></div></div>
          </div>
          <div class="rl-bar-container">
            <div class="rl-bar-label"><span>Simplification</span><span id="rl-simplify">&mdash;</span></div>
            <div class="rl-bar"><div class="rl-bar-fill" id="rl-simplify-bar" style="width:50%;background:var(--accent-secondary)"></div></div>
          </div>
          <div class="rl-bar-container">
            <div class="rl-bar-label"><span>Summary Freq</span><span id="rl-summary">&mdash;</span></div>
            <div class="rl-bar"><div class="rl-bar-fill" id="rl-summary-bar" style="width:50%;background:var(--accent)"></div></div>
          </div>
        </div>
      </div>

      <div class="mindease-tab-content" id="tab-session" role="tabpanel" aria-label="Session">
        <div class="mindease-section-title">This Session</div>
        <div class="profile-grid">
          <div class="profile-card">
            <div class="pc-label">Highlights</div>
            <div class="pc-value" id="sess-highlights">0</div>
          </div>
          <div class="profile-card">
            <div class="pc-label">Pauses</div>
            <div class="pc-value" id="sess-pauses">0</div>
          </div>
          <div class="profile-card">
            <div class="pc-label">Skips</div>
            <div class="pc-value" id="sess-skips">0</div>
          </div>
          <div class="profile-card">
            <div class="pc-label">Re-reads</div>
            <div class="pc-value" id="sess-rereads">0</div>
          </div>
        </div>
        <div class="mindease-section-title">Engagement Score</div>
        <div class="rl-bar-container">
          <div class="rl-bar-label"><span>Overall</span><span id="sess-score">0.0</span></div>
          <div class="rl-bar"><div class="rl-bar-fill" id="sess-score-bar" style="width:0%;background:var(--accent-gradient)"></div></div>
        </div>
        <div class="mindease-section-title">Focus Metrics</div>
        <div class="profile-grid">
          <div class="profile-card"><div class="pc-label">Duration</div><div class="pc-value" id="sess-duration">&mdash;</div></div>
          <div class="profile-card"><div class="pc-label">Focused</div><div class="pc-value" id="sess-focused">&mdash;</div></div>
          <div class="profile-card"><div class="pc-label">Interruptions</div><div class="pc-value" id="sess-interruptions">&mdash;</div></div>
          <div class="profile-card"><div class="pc-label">Longest Break</div><div class="pc-value" id="sess-longest">&mdash;</div></div>
        </div>
        <div class="mindease-section-title">Artifact Summary</div>
        <div class="profile-grid">
          <div class="profile-card"><div class="pc-label">Resources</div><div class="pc-value" id="sess-resources">0</div></div>
          <div class="profile-card"><div class="pc-label">Cards</div><div class="pc-value" id="sess-cards">0</div></div>
          <div class="profile-card"><div class="pc-label">Review</div><div class="pc-value" id="sess-review-cards">0</div></div>
          <div class="profile-card"><div class="pc-label">Gaps</div><div class="pc-value" id="sess-gaps">0</div></div>
        </div>
        <div class="mindease-section-title">Personal Notes</div>
        <div id="mindease-notes-list">
          <p style="color:var(--text-muted);font-size:0.78rem;text-align:center;padding:12px">Highlight text on the page to create notes.</p>
        </div>
      </div>
    </div>

    <div id="mindease-footer">
      <button class="mindease-btn mindease-btn-primary" id="mindease-end-session">End Session</button>
      <button class="mindease-btn mindease-btn-ghost" id="mindease-popout">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Full view
      </button>
      <button class="mindease-btn mindease-btn-ghost" id="mindease-toggle-side">${iconHTML("arrow-left-right")} Side</button>
    </div>
  `;

  document.body.appendChild(overlay);


  /* ── Focus trap ── */
  function focusTrap(e: KeyboardEvent): void {
    const focusable = overlay.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.key === "Tab") {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  overlay.addEventListener("keydown", focusTrap);

  /* ── Keyboard: Escape to close ── */
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      handleClose();
    }
  });

  /* ── Focus first focusable ── */
  setTimeout(() => {
    const firstBtn = overlay.querySelector<HTMLElement>("#mindease-minimize");
    firstBtn?.focus();
  }, 100);

  /* ── Tab switching ── */
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
      const panel = document.getElementById(`tab-${tabId}`);
      panel?.classList.add("active");
      panel?.focus();
      saveSidebarState({ activeTab: tabId as SidebarState["activeTab"] });
    });
  });

  /* ── Close handler ── */
  async function handleClose(): Promise<void> {
    overlay.removeAttribute("role");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";
    await saveSidebarState({
      visible: false,
      minimized: false,
      onRight,
      activeTab: (document.querySelector(".mindease-tab.active") as HTMLElement)?.dataset.tab as SidebarState["activeTab"] ?? "content",
      lastScrollY: window.scrollY,
    });
    ensureReopenStyles();
    const btn = injectReopenButton(_theme);
    btn.addEventListener("click", async () => {
      removeReopenButton();
      await saveSidebarState({ visible: true });
      overlay.style.display = "flex";
      overlay.removeAttribute("aria-hidden");
      overlay.setAttribute("role", "dialog");
      setTimeout(() => {
        const firstBtn = overlay.querySelector<HTMLElement>("#mindease-minimize");
        firstBtn?.focus();
      }, 100);
    });
  }

  document.getElementById("mindease-close")?.addEventListener("click", handleClose);

  /* ── Minimize ── */
  let minimized = false;
  document.getElementById("mindease-minimize")?.addEventListener("click", () => {
    minimized = !minimized;
    const body = document.getElementById("mindease-body");
    const tabs = document.getElementById("mindease-tabs");
    const stats = document.getElementById("mindease-stats-bar");
    const footer = document.getElementById("mindease-footer");
    if (minimized) {
      body!.style.display = "none";
      tabs!.style.display = "none";
      stats!.style.display = "none";
      footer!.style.display = "none";
      overlay.style.height = "auto";
    } else {
      body!.style.display = "";
      tabs!.style.display = "";
      stats!.style.display = "";
      footer!.style.display = "";
      overlay.style.height = "100vh";
    }
    saveSidebarState({ minimized });
  });

  /* ── End Session ── */
  document.getElementById("mindease-end-session")?.addEventListener("click", () => {
    browser.runtime.sendMessage({ type: "SESSION_END" }).catch(() => {});
  });

  /* ── Side toggle ── */
  let onRight = true;
  document.getElementById("mindease-toggle-side")?.addEventListener("click", () => {
    onRight = !onRight;
    overlay.style.right = onRight ? "0" : "auto";
    overlay.style.left = onRight ? "auto" : "0";
    overlay.style.borderLeft = onRight ? "1px solid var(--border)" : "none";
    overlay.style.borderRight = onRight ? "none" : "1px solid var(--border)";
    overlay.style.boxShadow = onRight ? "var(--shadow)" : "var(--shadow-right)";
    saveSidebarState({ onRight });
  });

  /* ── Theme toggle in overlay ── */
  document.getElementById("mindease-theme-toggle")?.addEventListener("click", () => {
    const next = _theme === "light" ? "dark" : "light";
    _theme = next;
    applyTheme(next);
    overlay.setAttribute("data-theme", next);
  });

  /* ── Pop out / Full view ── */
  document.getElementById("mindease-popout")?.addEventListener("click", () => {
    const contentEl = document.getElementById("tab-content");
    if (!contentEl) return;
    const w = window.open("", "_blank", "width=800,height=600,scrollbars=yes");
    if (!w) return;
    const themeStyle = _theme === "light"
      ? "body{background:#fff;color:#1a2332;font-family:sans-serif;padding:24px;max-width:800px;margin:auto}"
      : "body{background:#1a1d3a;color:#e5e0ff;font-family:sans-serif;padding:24px;max-width:800px;margin:auto}";
    w.document.write(`<!DOCTYPE html>
<html><head><title>MindEase - Content View</title>
<style>${themeStyle} .mindease-chunk{margin-bottom:20px;padding:16px;border:1px solid #e2e8f0;border-radius:8px} .chunk-concept-tag{font-weight:700;color:#3b82f6;margin-bottom:6px} .chunk-body{line-height:1.7;font-size:0.95rem} .chunk-summary{font-size:0.82rem;color:#64748b;margin-top:8px;padding:8px;background:#f8fafc;border-radius:6px}</style></head><body>${contentEl.innerHTML}</body></html>`);
    w.document.close();
  });

  /* ── Restore saved state ── */
  loadSidebarState().then((saved) => {
    if (saved.minimized) {
      minimized = true;
      const body = document.getElementById("mindease-body");
      const tabs = document.getElementById("mindease-tabs");
      const stats = document.getElementById("mindease-stats-bar");
      const footer = document.getElementById("mindease-footer");
      body!.style.display = "none";
      tabs!.style.display = "none";
      stats!.style.display = "none";
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
    if (saved.activeTab && saved.activeTab !== "content") {
      overlay.querySelectorAll(".mindease-tab").forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      overlay.querySelectorAll(".mindease-tab-content").forEach(t => t.classList.remove("active"));
      const tab = overlay.querySelector(`.mindease-tab[data-tab="${saved.activeTab}"]`) as HTMLElement;
      tab?.classList.add("active");
      tab?.setAttribute("aria-selected", "true");
      document.getElementById(`tab-${saved.activeTab}`)?.classList.add("active");
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

      const formatEl = document.getElementById("pc-format");
      if (formatEl) formatEl.textContent = String(baseline?.formatPreference ?? "-");
      const attentionEl = document.getElementById("pc-attention");
      if (attentionEl) attentionEl.textContent = String(baseline?.attentionSpan ?? "-");
      const paceEl = document.getElementById("pc-pace");
      if (paceEl) paceEl.textContent = String(baseline?.readingPace ?? "-");
      const sessionsEl = document.getElementById("pc-sessions");
      if (sessionsEl) sessionsEl.textContent = String(rlState?.sessionCount ?? 0);

      const chunkMap: Record<string, number> = { small: 25, medium: 50, large: 75 };
      const simplifyMap: Record<string, number> = { "1": 33, "2": 66, "3": 100 };
      const summaryMap: Record<string, number> = { low: 25, medium: 50, high: 75 };

      const chunkBarEl = document.getElementById("rl-chunk-bar");
      const chunkEl = document.getElementById("rl-chunk");
      if (chunkBarEl) chunkBarEl.style.width = `${chunkMap[String(params?.chunkSize)] ?? 50}%`;
      if (chunkEl) chunkEl.textContent = String(params?.chunkSize ?? "-");

      const simplifyBarEl = document.getElementById("rl-simplify-bar");
      const simplifyEl = document.getElementById("rl-simplify");
      if (simplifyBarEl) simplifyBarEl.style.width = `${simplifyMap[String(params?.simplificationLevel)] ?? 50}%`;
      if (simplifyEl) simplifyEl.textContent = String(params?.simplificationLevel ?? "-");

      const summaryBarEl = document.getElementById("rl-summary-bar");
      const summaryEl = document.getElementById("rl-summary");
      if (summaryBarEl) summaryBarEl.style.width = `${summaryMap[String(params?.summaryFrequency)] ?? 50}%`;
      if (summaryEl) summaryEl.textContent = String(params?.summaryFrequency ?? "-");
    }

    if (stats) {
      const hlEl = document.getElementById("sess-highlights");
      if (hlEl) hlEl.textContent = String(stats.totalHighlights ?? 0);
      const pauseEl = document.getElementById("sess-pauses");
      if (pauseEl) pauseEl.textContent = String(stats.totalPauses ?? 0);
      const skipEl = document.getElementById("sess-skips");
      if (skipEl) skipEl.textContent = String(stats.totalSkips ?? 0);
      const rl = profile?.rlState as Record<string, unknown> | undefined;
      const rereadEl = document.getElementById("sess-rereads");
      if (rereadEl) rereadEl.textContent = String(rl?.reReadRate ?? 0);
      const score = Number(rl?.totalEngagementScore ?? 0);
      const scoreEl = document.getElementById("sess-score");
      if (scoreEl) scoreEl.textContent = score.toFixed(1);
      const scoreBarEl = document.getElementById("sess-score-bar");
      if (scoreBarEl) scoreBarEl.style.width = `${Math.min(Math.max(score * 10, 0), 100)}%`;
    }

    // Render focus summary from artifact if available
    if (artifact) {
      const focus = artifact.focusSummary as Record<string, unknown> | undefined;
      if (focus) {
        const durationEl = document.getElementById("sess-duration");
        if (durationEl) durationEl.textContent = fmtDurationLocal(Number(focus.totalDurationMs ?? 0));
        const focusedEl = document.getElementById("sess-focused");
        if (focusedEl) focusedEl.textContent = fmtDurationLocal(Number(focus.focusedTimeMs ?? 0));
        const interruptEl = document.getElementById("sess-interruptions");
        if (interruptEl) interruptEl.textContent = String(focus.interruptionCount ?? 0);
        const longestEl = document.getElementById("sess-longest");
        if (longestEl) longestEl.textContent = fmtDurationLocal(Number(focus.longestInterruptionMs ?? 0));
      }
      const resources = artifact.resourcesUsed as Array<Record<string, unknown>> | undefined;
      if (resources) {
        const resEl = document.getElementById("sess-resources");
        if (resEl) resEl.textContent = String(resources.length);
      }
      const cards = artifact.studyCards as Array<Record<string, unknown>> | undefined;
      if (cards) {
        const cardsEl = document.getElementById("sess-cards");
        if (cardsEl) cardsEl.textContent = String(cards.length);
        const reviewCards = cards.filter(c => c.reviewFlag).length;
        const reviewEl = document.getElementById("sess-review-cards");
        if (reviewEl) reviewEl.textContent = String(reviewCards);
      }
      const gaps = artifact.needsReview as Array<Record<string, unknown>> | undefined;
      if (gaps) {
        const gapsEl = document.getElementById("sess-gaps");
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
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Visuals Display
   ═══════════════════════════════════════════════════════════════════════════════ */

let _visualEntries: VisualEntry[] = [];

function renderVisuals(visuals: VisualEntry[]): void {
  _visualEntries = visuals;

  const grid = document.getElementById("mindease-visuals-grid");
  const badge = document.getElementById("visuals-badge");
  if (!grid) return;

  if (badge) {
    badge.textContent = String(visuals.length);
    badge.style.display = "inline-flex";
  }

  if (visuals.length === 0) {
    grid.innerHTML = `<p class="visuals-placeholder">
      ${iconHTML("image")} Generating visuals...<br>
      <span style="font-size:0.7rem;color:var(--text-muted);display:block;margin-top:6px">
        Make sure the local proxy is running: <code>npm run napkin-proxy</code>
      </span>
    </p>`;
    return;
  }

  grid.innerHTML = visuals.map((v) => {
    const sourceLabel = "Napkin";
    return `
      <div class="visual-card">
        <img class="visual-card-img"
             src="${v.dataUrl}"
             alt="${_escHtml(v.concept)}"
             loading="lazy"
             style="aspect-ratio:${v.width}/${v.height}"
        />
        <div class="visual-card-footer">
          <span>${_escHtml(v.concept)}</span>
          <span class="visual-card-source ${v.source}">${sourceLabel}</span>
        </div>
      </div>
    `;
  }).join("");

  // Switch to visuals tab so user sees them immediately
  const visualsTab = document.querySelector('.mindease-tab[data-tab="visuals"]') as HTMLElement | null;
  if (visualsTab) {
    visualsTab.click();
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

  const baseBg = _theme === "light" ? "rgba(245, 247, 250, 0.95)" : "rgba(15, 23, 36, 0.92)";
  const baseText = _theme === "light" ? "#1a2332" : "#f0f4f8";
  const accentColor = _theme === "light" ? "#3b82f6" : "#4EB8FF";

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
    box-shadow: 0 4px 24px ${_theme === "light" ? "rgba(59,130,246,0.2)" : "rgba(78,184,255,0.2)"};
  `;
  document.body.appendChild(captionOverlay);

  const pageText = document.querySelector("#description")?.textContent?.slice(0, 2000)
    ?? document.title + " - YouTube video";

  browser.runtime.sendMessage({
    type: "TRANSFORM_CONTENT",
    payload: { text: pageText, pageType: "video" },
  }).catch(() => {});

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

  _cleanupYouTube = () => {
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
  const pdfText = document.body?.innerText?.slice(0, 4000)
    ?? "PDF document \u2014 unable to extract text directly";

  const loader = document.createElement("div");
  loader.id = "mindease-pdf-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");

  const accentColor = _theme === "light" ? "#3b82f6" : "#4EB8FF";
  const baseBg = _theme === "light" ? "#ffffff" : "#0f1724";
  const baseText = _theme === "light" ? "#1a2332" : "#e8edf5";

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
  loader.innerHTML = `<span style="display:inline-flex;animation:mindease-spin 1s linear infinite">${iconHTML("refresh-cw")}</span> MindEase &mdash; Simplifying PDF...`;
  document.body?.appendChild(loader);

  browser.runtime.sendMessage({
    type: "TRANSFORM_CONTENT",
    payload: { text: pdfText, pageType: "pdf" },
  }).catch(() => {});

  setTimeout(() => loader?.remove(), 30000);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Q-Table Visualizer - debug panel showing RL agent state
   ═══════════════════════════════════════════════════════════════════════════════ */

let qPanel: HTMLDivElement | null = null;
let qPollTimer: ReturnType<typeof setInterval> | null = null;

const ACTIONS_LABELS = [
  "chunk+", "chunk-", "simpl+", "simpl-", "pace+", "pace-", "visuals", "summ+", "summ-",
];

function renderQTablePanel(qTable: QTable): void {
  if (!qPanel) {
    qPanel = document.createElement("div");
    qPanel.id = "mindease-qtable-panel";
    qPanel.style.cssText = `
      position: fixed; bottom: 10px; right: 10px;
      background: #0d1829; color: #4EB8FF;
      padding: 10px 12px; font-size: 10px; font-family: monospace;
      z-index: 2147483646; border: 1px solid #4EB8FF;
      max-height: 220px; overflow-y: auto; width: 260px;
      border-radius: 8px; opacity: 0.92;
      pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(qPanel);
  }

  const entries = Object.entries(qTable);
  if (entries.length === 0) {
    qPanel.innerHTML = `<div style="color:#888;">Q-Table: empty (no signals yet)</div>`;
    return;
  }

  // Show top 5 states by max Q-value
  const ranked = entries
    .map(([key, vals]) => ({ key, maxQ: Math.max(...vals), vals }))
    .sort((a, b) => b.maxQ - a.maxQ)
    .slice(0, 5);

  qPanel.innerHTML = `
    <div style="font-weight:bold;margin-bottom:4px;color:#fff;font-size:11px;">
      Q-Table (${entries.length} states)
    </div>
    ${ranked.map(e => `
      <div style="margin-bottom:3px;border-bottom:1px solid rgba(78,184,255,0.15);padding-bottom:2px;">
        <div style="color:#8899b4;font-size:8px;">${e.key}</div>
        <div>${e.vals.map((v, i) => `
          <span style="color:${v > 0 ? '#4ade80' : v < 0 ? '#f87171' : '#64748b'};margin-right:4px;">
            ${ACTIONS_LABELS[i]}:${v.toFixed(2)}
          </span>
        `).join('')}</div>
      </div>
    `).join('')}
    <div style="color:#64748b;font-size:8px;margin-top:2px;">
      max: ${ranked[0]?.maxQ.toFixed(3) ?? "-"}
    </div>
  `;
}

async function pollQTable(): Promise<void> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.QTABLE);
    const qTable = (result[STORAGE_KEYS.QTABLE] as QTable) ?? {};
    renderQTablePanel(qTable);
  } catch {
    // storage not available yet
  }
}

function startQTablePolling(): void {
  if (qPollTimer) return;
  // Initial render after short delay
  setTimeout(pollQTable, 2000);
  qPollTimer = setInterval(pollQTable, 5000);
}

function stopQTablePolling(): void {
  if (qPollTimer) {
    clearInterval(qPollTimer);
    qPollTimer = null;
  }
  if (qPanel) {
    qPanel.remove();
    qPanel = null;
  }
}

// If already active, start immediately
if (_extensionActive) {
  setTimeout(startQTablePolling, 3000);
}
