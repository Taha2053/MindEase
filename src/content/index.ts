/* ============================================================
   content/index.ts — Content Script
   Runs inside every webpage the student visits.
   Detects content type, tracks behavioral signals for Layer 2,
   and activates the appropriate layer.
   ============================================================ */

import browser from "webextension-polyfill";
import type { ContentChunk } from "../types/index.js";

function shouldActivate(): boolean {
  const url = window.location.href;
  const hostname = window.location.hostname;

  const blacklist = [
    "instagram.com", "twitter.com", "x.com", "facebook.com",
    "tiktok.com", "snapchat.com", "reddit.com", "pinterest.com",
    "netflix.com", "twitch.tv", "discord.com", "whatsapp.com",
    "linkedin.com", "tumblr.com", "imgur.com",
  ];
  if (blacklist.some(b => hostname.includes(b))) return false;

  const whitelist = [
    "wikipedia.org", "youtube.com", "coursera.org", "edx.org",
    "khanacademy.org", "udemy.com", "scholar.google.com",
    "arxiv.org", "pubmed.ncbi.nlm.nih.gov", "jstor.org",
    "researchgate.net", "academia.edu", "mit.edu", "stanford.edu",
    "medium.com", "dev.to", "docs.google.com", "notion.so",
    "github.com", "stackoverflow.com", "moodle", "blackboard",
    "brightspace.com", "canvas.instructure.com",
  ];
  if (whitelist.some(w => hostname.includes(w))) return true;

  if (url.endsWith(".pdf") || document.contentType === "application/pdf") return true;

  const hasArticle = !!document.querySelector("article, .article, [role='main'], main");
  const hasLongText = document.body?.innerText?.length > 2000;
  const hasHeadings = document.querySelectorAll("h1,h2,h3").length >= 2;
  const isNotApp = !document.querySelector("[data-reactroot], #__next, #app:not(body)");

  return hasArticle && hasLongText && hasHeadings && isNotApp;
}

/* ─── Keepalive ping — wake service worker before heavy messages ──────────── */
async function wakeServiceWorker(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: "PING" });
  } catch {
    /* ignore — just waking the worker */
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
const SKIP_SPEED_THRESHOLD_PX_PER_MS = 1.5; /* px per ms — very fast scroll */

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

/* ─── Emit signal to background ─────────────────────────────────────────────── */

/* ─── Activity ping — reset workspace idle timer ─────────────────────────── */
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
  }).catch(() => {
    /* Background might not be ready */
  });

  // Also send activity ping for workspace idle timer
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
  /* Find which section the user is currently viewing (within viewport) */
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

  /* Record scroll positions for speed detection */
  scrollHistory.push({ y: currentScrollY, time: now });
  if (scrollHistory.length > SCROLL_HISTORY_SIZE) {
    scrollHistory.shift();
  }

  /* Detect skip (very fast scroll past a section) */
  if (scrollHistory.length >= 2) {
    const oldest = scrollHistory[0];
    const elapsed = now - oldest.time;
    const distance = Math.abs(currentScrollY - oldest.y);
    const speed = distance / elapsed; /* px per ms */

    if (speed > SKIP_SPEED_THRESHOLD_PX_PER_MS && elapsed < 1000) {
      /* Skip detection — find sections that were scrolled past */
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

  /* Detect reRead (scrolling back up to a previously visited section) */
  if (currentScrollY < lastScrollY) {
    const section = findCurrentSection(currentScrollY);
    if (section && section.visited && (now - section.lastVisitTime) > 5000) {
      emitSignal("reRead", section.id);
    }
  }

  /* Mark current section as visited */
  const currentSection = findCurrentSection(currentScrollY);
  if (currentSection) {
    if (!currentSection.visited) {
      currentSection.visited = true;
      currentSection.firstVisitTime = now;
    }
    currentSection.lastVisitTime = now;
  }

  /* Pause detection: if scroll stops for >3s, emit pause */
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

  const text = selection.toString().trim();
  if (text.length < 3) return; /* ignore accidental selections */

  const range = selection.getRangeAt(0);
  let sectionId = "page";
  if (range.startContainer.parentElement) {
    sectionId = computeSectionId(
      range.startContainer.parentElement.closest("[class]") as HTMLElement ?? range.startContainer.parentElement as HTMLElement
    );
  }

  emitSignal("highlight", sectionId);

  /* Also send the highlighted text as a note for the workspace artifact */
  const tabId = 0; /* tabId not available from content script — background uses sender */
  browser.runtime.sendMessage({
    type: "HIGHLIGHT_NOTE",
    payload: {
      text,
      tabId,
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

/* ─── Init behavior tracking ────────────────────────────────────────────────── */

function initBehaviorTracking(): void {
  buildSections();

  window.addEventListener("scroll", throttledScroll, { passive: true });
  document.addEventListener("mouseup", handleTextSelection);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("click", sendActivityPing);
  document.addEventListener("keydown", sendActivityPing);

  /* Rebuild sections when DOM changes (lazy-loaded content) */
  const observer = new MutationObserver(() => {
    buildSections();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ── Entry point ─────────────────────────────────────────────────────────────── */

if (shouldActivate()) {
  const sourceType = detectSourceType();

  if (sourceType) {
    console.log(`[MindEase Content] Detected source: ${sourceType}`);

    /* Notify background that a new session source has been detected */
    browser.runtime.sendMessage({
      type: "SESSION_START",
      payload: {
        sourceType,
        url: window.location.href,
        timestamp: Date.now(),
        title: document.title,
      },
    });

    /* Start Layer 2 behavior tracking */
    initBehaviorTracking();

    /* Layer 1 — trigger content transformation after SW wake delay */
    setTimeout(async () => {
      await wakeServiceWorker();
      if (sourceType === "video") {
        await initYouTubeMode();
      } else if (sourceType === "pdf") {
        await initPDFMode();
      } else {
        initContentTransformation(sourceType ?? "website");
      }
    }, 5000);
  }
} else {
  console.log("[MindEase] Skipping non-educational site:", window.location.hostname);
}

/* ─── Layer 1: Content Transformation + Overlay ─────────────────────────────── */

async function initContentTransformation(pageType: string): Promise<void> {
  try {
    const text = document.body.innerText.slice(0, 4000);
    if (text.trim().length < 50) return;
    console.log("[MindEase Content] Sending TRANSFORM_CONTENT...");
    browser.runtime.sendMessage({
      type: "TRANSFORM_CONTENT",
      payload: { text, pageType },
    }).catch(() => {});
  } catch (err) {
    console.error("[MindEase] Transform send error:", err);
  }
}

/* Receive pushed response from background */
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; chunks?: ContentChunk[]; error?: string };
  if (msg.type === "TRANSFORMED_CONTENT" && msg.chunks && msg.chunks.length > 0) {
    console.log("[MindEase Content] Received chunks:", msg.chunks.length);
    injectOverlay(msg.chunks);
  }
  if (msg.type === "TRANSFORM_ERROR") {
    console.error("[MindEase Content] Transform error:", msg.error);
  }
});

/* ─── Floating Overlay Panel ────────────────────────────────────────────────── */

function injectOverlay(chunks: ContentChunk[]): void {
  document.getElementById("mindease-overlay")?.remove();
  document.getElementById("mindease-pdf-loader")?.remove();

  const conceptChunks = chunks.filter(c => c.text.includes("[CONCEPT:"));
  const regularChunks = chunks.filter(c => !c.text.includes("[CONCEPT:"));

  const overlay = document.createElement("div");
  overlay.id = "mindease-overlay";

  const styles = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

      #mindease-overlay {
        position: fixed;
        top: 0;
        right: 0;
        width: 400px;
        height: 100vh;
        background: #080f1a;
        color: #e8edf5;
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 13.5px;
        line-height: 1.65;
        letter-spacing: 0.025em;
        z-index: 2147483647;
        box-shadow: -8px 0 48px rgba(0,0,0,0.7);
        display: flex;
        flex-direction: column;
        border-left: 1px solid #1a2d45;
        overflow: hidden;
        animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      #mindease-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: #0d1829;
        border-bottom: 1px solid #1a2d45;
        flex-shrink: 0;
      }

      #mindease-logo {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      #mindease-logo .logo-icon {
        width: 28px;
        height: 28px;
        background: linear-gradient(135deg, #4EB8FF, #7B6FFF);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
      }

      #mindease-logo .logo-text {
        font-size: 0.9rem;
        font-weight: 600;
        color: #e8edf5;
        letter-spacing: 0.05em;
      }

      #mindease-logo .logo-badge {
        font-size: 0.6rem;
        color: #4EB8FF;
        background: rgba(78,184,255,0.12);
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
        letter-spacing: 0.05em;
      }

      #mindease-controls {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      #mindease-minimize {
        background: none;
        border: 1px solid #1a2d45;
        color: #64748b;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      #mindease-minimize:hover { color: #e8edf5; border-color: #4EB8FF; background: rgba(78,184,255,0.08); }

      #mindease-close {
        background: none;
        border: 1px solid #1a2d45;
        color: #64748b;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      #mindease-close:hover { color: #ef4444; border-color: #ef4444; background: rgba(239,68,68,0.08); }

      #mindease-tabs {
        display: flex;
        background: #0d1829;
        border-bottom: 1px solid #1a2d45;
        flex-shrink: 0;
      }

      .mindease-tab {
        flex: 1;
        padding: 10px 8px;
        font-size: 0.72rem;
        font-weight: 500;
        color: #64748b;
        text-align: center;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.15s;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .mindease-tab:hover { color: #94a3b8; }
      .mindease-tab.active { color: #4EB8FF; border-bottom-color: #4EB8FF; }

      #mindease-stats-bar {
        display: flex;
        gap: 0;
        background: #0a1422;
        border-bottom: 1px solid #1a2d45;
        flex-shrink: 0;
      }

      .mindease-stat {
        flex: 1;
        padding: 8px 4px;
        text-align: center;
        border-right: 1px solid #1a2d45;
      }
      .mindease-stat:last-child { border-right: none; }
      .mindease-stat .s-num {
        font-size: 1.1rem;
        font-weight: 600;
        color: #e8edf5;
        display: block;
      }
      .mindease-stat .s-label {
        font-size: 0.58rem;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      #mindease-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        scroll-behavior: smooth;
      }

      #mindease-body::-webkit-scrollbar { width: 4px; }
      #mindease-body::-webkit-scrollbar-track { background: transparent; }
      #mindease-body::-webkit-scrollbar-thumb { background: #1a2d45; border-radius: 2px; }

      .mindease-tab-content { display: none; }
      .mindease-tab-content.active { display: block; }

      .mindease-chunk {
        margin-bottom: 12px;
        padding: 14px;
        background: #0d1829;
        border-radius: 10px;
        border: 1px solid #1a2d45;
        transition: border-color 0.15s;
        animation: fadeUp 0.3s ease both;
      }
      .mindease-chunk:hover { border-color: #2a4a6a; }

      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .mindease-chunk.has-concept {
        border-color: rgba(78,184,255,0.2);
        background: linear-gradient(135deg, #0d1829, #0d1e35);
      }

      .chunk-concept-tag {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #4EB8FF;
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 8px;
        background: rgba(78,184,255,0.1);
        padding: 3px 8px;
        border-radius: 4px;
      }

      .chunk-text {
        color: #cbd5e1;
        font-size: 0.855rem;
        line-height: 1.7;
      }

      .chunk-summary {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #1a2d45;
        font-size: 0.78rem;
        color: #7B6FFF;
        font-style: italic;
      }

      .mindease-section-title {
        font-size: 0.65rem;
        font-weight: 600;
        color: #475569;
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
        background: #1a2d45;
      }

      #mindease-footer {
        padding: 12px 16px;
        background: #0a1422;
        border-top: 1px solid #1a2d45;
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
      }

      .mindease-btn-primary {
        background: linear-gradient(135deg, #4EB8FF, #7B6FFF);
        color: #080f1a;
        font-weight: 600;
      }
      .mindease-btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }

      .mindease-btn-ghost {
        background: transparent;
        color: #64748b;
        border: 1px solid #1a2d45;
      }
      .mindease-btn-ghost:hover { color: #e8edf5; border-color: #2a4a6a; }

      .profile-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }
      .profile-card {
        background: #0d1829;
        border: 1px solid #1a2d45;
        border-radius: 8px;
        padding: 10px;
      }
      .profile-card .pc-label {
        font-size: 0.6rem;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 4px;
      }
      .profile-card .pc-value {
        font-size: 0.82rem;
        font-weight: 500;
        color: #4EB8FF;
      }

      .rl-bar-container {
        margin-bottom: 8px;
      }
      .rl-bar-label {
        display: flex;
        justify-content: space-between;
        font-size: 0.72rem;
        color: #64748b;
        margin-bottom: 4px;
      }
      .rl-bar {
        height: 4px;
        background: #1a2d45;
        border-radius: 2px;
        overflow: hidden;
      }
      .rl-bar-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.5s ease;
      }
    </style>
  `;

  const totalConcepts = conceptChunks.length;
  const summaryChunks = chunks.filter(c => c.text.includes("[SUMMARY:"));

  const chunksHTML = chunks.map((chunk, i) => {
    const hasConcept = chunk.text.includes("[CONCEPT:");
    const conceptMatch = chunk.text.match(/\[CONCEPT:\s*([^\]]+)\]/);
    const summaryMatch = chunk.text.match(/\[SUMMARY:\s*([^\]]+)\]/);
    const cleanText = chunk.text
      .replace(/\[CONCEPT:[^\]]+\]/g, "")
      .replace(/\[SUMMARY:[^\]]+\]/g, "")
      .trim();
    const concept = conceptMatch?.[1]?.trim() ?? "";
    const summary = summaryMatch?.[1]?.trim() ?? "";

    return `
      <div class="mindease-chunk ${hasConcept ? "has-concept" : ""}"
           style="animation-delay: ${i * 0.04}s">
        ${concept ? `<div class="chunk-concept-tag">&#9734; ${concept}</div>` : ""}
        <div class="chunk-text">${cleanText}</div>
        ${summary ? `<div class="chunk-summary">&#8618; ${summary}</div>` : ""}
      </div>
    `;
  }).join("");

  overlay.innerHTML = `
    ${styles}
    <div id="mindease-header">
      <div id="mindease-logo">
        <div class="logo-icon">&#x1F9E0;</div>
        <span class="logo-text">MindEase</span>
        <span class="logo-badge">ADAPTIVE</span>
      </div>
      <div id="mindease-controls">
        <button id="mindease-minimize" title="Minimize">&minus;</button>
        <button id="mindease-close" title="Close">&#x2715;</button>
      </div>
    </div>

    <div id="mindease-tabs">
      <div class="mindease-tab active" data-tab="content">Content</div>
      <div class="mindease-tab" data-tab="profile">Profile</div>
      <div class="mindease-tab" data-tab="session">Session</div>
    </div>

    <div id="mindease-stats-bar">
      <div class="mindease-stat">
        <span class="s-num">${chunks.length}</span>
        <span class="s-label">Chunks</span>
      </div>
      <div class="mindease-stat">
        <span class="s-num">${totalConcepts}</span>
        <span class="s-label">Concepts</span>
      </div>
      <div class="mindease-stat">
        <span class="s-num">${summaryChunks.length}</span>
        <span class="s-label">Summaries</span>
      </div>
      <div class="mindease-stat">
        <span class="s-num" id="mindease-engage-count">0</span>
        <span class="s-label">Engaged</span>
      </div>
    </div>

    <div id="mindease-body">
      <div class="mindease-tab-content active" id="tab-content">
        ${chunks.length === 0
          ? '<p style="color:#475569;text-align:center;padding:24px">No content chunks yet.</p>'
          : chunksHTML
        }
      </div>

      <div class="mindease-tab-content" id="tab-profile">
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
            <div class="rl-bar"><div class="rl-bar-fill" id="rl-chunk-bar" style="width:50%;background:#4EB8FF"></div></div>
          </div>
          <div class="rl-bar-container">
            <div class="rl-bar-label"><span>Simplification</span><span id="rl-simplify">&mdash;</span></div>
            <div class="rl-bar"><div class="rl-bar-fill" id="rl-simplify-bar" style="width:50%;background:#7B6FFF"></div></div>
          </div>
          <div class="rl-bar-container">
            <div class="rl-bar-label"><span>Summary Freq</span><span id="rl-summary">&mdash;</span></div>
            <div class="rl-bar"><div class="rl-bar-fill" id="rl-summary-bar" style="width:50%;background:#4EB8FF"></div></div>
          </div>
        </div>
      </div>

      <div class="mindease-tab-content" id="tab-session">
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
          <div class="rl-bar"><div class="rl-bar-fill" id="sess-score-bar" style="width:0%;background:linear-gradient(90deg,#4EB8FF,#7B6FFF)"></div></div>
        </div>
      </div>
    </div>

    <div id="mindease-footer">
      <button class="mindease-btn mindease-btn-primary" id="mindease-end-session">End Session</button>
      <button class="mindease-btn mindease-btn-ghost" id="mindease-toggle-side">&#x21C4; Side</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelectorAll(".mindease-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      overlay.querySelectorAll(".mindease-tab").forEach(t => t.classList.remove("active"));
      overlay.querySelectorAll(".mindease-tab-content").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const tabId = (tab as HTMLElement).dataset.tab;
      document.getElementById(`tab-${tabId}`)?.classList.add("active");
    });
  });

  document.getElementById("mindease-close")?.addEventListener("click", () => overlay.remove());

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
  });

  document.getElementById("mindease-end-session")?.addEventListener("click", () => {
    browser.runtime.sendMessage({ type: "SESSION_END" }).catch(() => {});
  });

  let onRight = true;
  document.getElementById("mindease-toggle-side")?.addEventListener("click", () => {
    onRight = !onRight;
    overlay.style.right = onRight ? "0" : "auto";
    overlay.style.left = onRight ? "auto" : "0";
    overlay.style.borderLeft = onRight ? "1px solid #1a2d45" : "none";
    overlay.style.borderRight = onRight ? "none" : "1px solid #1a2d45";
    overlay.style.boxShadow = onRight
      ? "-8px 0 48px rgba(0,0,0,0.7)"
      : "8px 0 48px rgba(0,0,0,0.7)";
  });

  browser.storage.local.get(["mindease_profile", "mindease_session_stats"]).then((result: Record<string, unknown>) => {
    const profile = result.mindease_profile as Record<string, unknown> | undefined;
    const stats = result.mindease_session_stats as Record<string, unknown> | undefined;

    if (profile) {
      const baseline = profile.baseline as Record<string, unknown> | undefined;
      const rlState = profile.rlState as Record<string, unknown> | undefined;
      const params = profile.transformationParams as Record<string, unknown> | undefined;

      const formatEl = document.getElementById("pc-format");
      if (formatEl) formatEl.textContent = String(baseline?.formatPreference ?? "&mdash;");
      const attentionEl = document.getElementById("pc-attention");
      if (attentionEl) attentionEl.textContent = String(baseline?.attentionSpan ?? "&mdash;");
      const paceEl = document.getElementById("pc-pace");
      if (paceEl) paceEl.textContent = String(baseline?.readingPace ?? "&mdash;");
      const sessionsEl = document.getElementById("pc-sessions");
      if (sessionsEl) sessionsEl.textContent = String(rlState?.sessionCount ?? 0);

      const chunkMap: Record<string, number> = { small: 25, medium: 50, large: 75 };
      const simplifyMap: Record<string, number> = { "1": 33, "2": 66, "3": 100 };
      const summaryMap: Record<string, number> = { low: 25, medium: 50, high: 75 };

      const chunkBarEl = document.getElementById("rl-chunk-bar");
      const chunkEl = document.getElementById("rl-chunk");
      if (chunkBarEl) chunkBarEl.style.width = `${chunkMap[String(params?.chunkSize)] ?? 50}%`;
      if (chunkEl) chunkEl.textContent = String(params?.chunkSize ?? "&mdash;");

      const simplifyBarEl = document.getElementById("rl-simplify-bar");
      const simplifyEl = document.getElementById("rl-simplify");
      if (simplifyBarEl) simplifyBarEl.style.width = `${simplifyMap[String(params?.simplificationLevel)] ?? 50}%`;
      if (simplifyEl) simplifyEl.textContent = String(params?.simplificationLevel ?? "&mdash;");

      const summaryBarEl = document.getElementById("rl-summary-bar");
      const summaryEl = document.getElementById("rl-summary");
      if (summaryBarEl) summaryBarEl.style.width = `${summaryMap[String(params?.summaryFrequency)] ?? 50}%`;
      if (summaryEl) summaryEl.textContent = String(params?.summaryFrequency ?? "&mdash;");
    }

    if (stats) {
      const hlEl = document.getElementById("sess-highlights");
      if (hlEl) hlEl.textContent = String(stats.totalHighlights ?? 0);
      const pauseEl = document.getElementById("sess-pauses");
      if (pauseEl) pauseEl.textContent = String(stats.totalPauses ?? 0);
      const skipEl = document.getElementById("sess-skips");
      if (skipEl) skipEl.textContent = String(stats.totalSkips ?? 0);
      const rereadEl = document.getElementById("sess-rereads");
      if (rereadEl) rereadEl.textContent = String(stats.totalReReads ?? 0);
      const score = Number(stats.totalEngagementScore ?? 0);
      const scoreEl = document.getElementById("sess-score");
      if (scoreEl) scoreEl.textContent = score.toFixed(1);
      const scoreBarEl = document.getElementById("sess-score-bar");
      if (scoreBarEl) scoreBarEl.style.width = `${Math.min(score * 10, 100)}%`;
    }
  });
}

/* ─── YouTube Mode ─────────────────────────────────────────────────────────── */

async function initYouTubeMode(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 3000));

  const video = document.querySelector("video") as HTMLVideoElement;
  if (!video) return;

  const captionOverlay = document.createElement("div");
  captionOverlay.id = "mindease-caption-overlay";
  captionOverlay.style.cssText = `
    position: fixed;
    bottom: 120px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 800px;
    width: 90%;
    background: rgba(15, 23, 36, 0.92);
    color: #f0f4f8;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 18px;
    line-height: 1.6;
    letter-spacing: 0.04em;
    padding: 12px 20px;
    border-radius: 12px;
    border: 1px solid #4EB8FF;
    z-index: 2147483647;
    text-align: center;
    backdrop-filter: blur(8px);
    display: none;
    box-shadow: 0 4px 24px rgba(78,184,255,0.2);
  `;
  document.body.appendChild(captionOverlay);

  const pageText = document.querySelector("#description")?.textContent?.slice(0, 2000)
    ?? document.title + " - YouTube video";

  browser.runtime.sendMessage({
    type: "TRANSFORM_CONTENT",
    payload: { text: pageText, pageType: "video" },
  }).catch(() => {});

  let captionChunks: string[] = [];

  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type: string; chunks?: Array<{ text: string }> };
    if (msg.type === "TRANSFORMED_CONTENT" && msg.chunks) {
      captionChunks = msg.chunks.map(c => c.text);
    }
  });

  video.addEventListener("timeupdate", () => {
    if (captionChunks.length === 0) return;
    const progress = video.currentTime / (video.duration || 1);
    const index = Math.floor(progress * captionChunks.length);
    const caption = captionChunks[Math.min(index, captionChunks.length - 1)];
    if (caption) {
      captionOverlay.style.display = "block";
      captionOverlay.textContent = caption;
    }
  });

  video.addEventListener("pause", () => {
    captionOverlay.style.display = "none";
  });
  video.addEventListener("play", () => {
    if (captionChunks.length > 0) captionOverlay.style.display = "block";
  });
}

/* ─── PDF Mode ────────────────────────────────────────────────────────────── */

async function initPDFMode(): Promise<void> {
  const pdfText = document.body?.innerText?.slice(0, 4000)
    ?? "PDF document — unable to extract text directly";

  const loader = document.createElement("div");
  loader.id = "mindease-pdf-loader";
  loader.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #0f1724;
    color: #4EB8FF;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    padding: 10px 16px;
    border-radius: 8px;
    border: 1px solid #4EB8FF;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  loader.innerHTML = '<span style="animation: spin 1s linear infinite; display:inline-block">&#x27F3;</span> MindEase &mdash; Simplifying PDF...';
  document.body?.appendChild(loader);

  browser.runtime.sendMessage({
    type: "TRANSFORM_CONTENT",
    payload: { text: pdfText, pageType: "pdf" },
  }).catch(() => {});

  setTimeout(() => loader?.remove(), 30000);
}
