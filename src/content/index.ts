/* ============================================================
   content/index.ts — Content Script
   Runs inside every webpage the student visits.
   Detects content type, tracks behavioral signals for Layer 2,
   and activates the appropriate layer.
   ============================================================ */

import browser from "webextension-polyfill";

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

  /* Rebuild sections when DOM changes (lazy-loaded content) */
  const observer = new MutationObserver(() => {
    buildSections();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ── Entry point ─────────────────────────────────────────────────────────────── */

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
    },
  });

  /* Start Layer 2 behavior tracking */
  initBehaviorTracking();

  /* Layer 1 — trigger content transformation after a short delay */
  setTimeout(() => {
    initContentTransformation(sourceType === "video" ? "website" : sourceType ?? "website");
  }, 2000);
}

/* ─── Layer 1: Content Transformation + Overlay ─────────────────────────────── */

async function initContentTransformation(pageType: "website" | "pdf" | "lecture"): Promise<void> {
  try {
    /* Extract page text */
    const pageText = document.body.innerText.slice(0, 4000);
    if (pageText.trim().length < 50) return; /* skip pages with no meaningful text */

    /* Request transformation from background */
    const response = await browser.runtime.sendMessage({
      type: "TRANSFORM_CONTENT",
      payload: { text: pageText, pageType },
    });

    const transformResponse = response as { type: string; chunks: { id: string; text: string }[] } | undefined;
    if (transformResponse?.type === "TRANSFORMED_CONTENT" && transformResponse.chunks?.length > 0) {
      injectOverlay(transformResponse.chunks);
    }
  } catch {
    /* Background might not handle this message type yet */
  }
}

/* ─── Floating Overlay Panel ────────────────────────────────────────────────── */

interface OverlayChunk {
  id: string;
  text: string;
}

function injectOverlay(chunks: OverlayChunk[]): void {
  /* Remove existing overlay if any */
  const existing = document.getElementById("mindease-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "mindease-overlay";
  overlay.innerHTML = `
    <style>
      #mindease-overlay {
        position: fixed;
        top: 0;
        right: 0;
        width: 380px;
        height: 100vh;
        background: #0f1724;
        color: #f0f4f8;
        font-family: 'Segoe UI', 'Arial', sans-serif;
        font-size: 14px;
        line-height: 1.6;
        letter-spacing: 0.03em;
        z-index: 2147483647;
        box-shadow: -4px 0 24px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
        border-left: 1px solid #2a3a4a;
        overflow: hidden;
      }
      #mindease-overlay-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: #1a2332;
        border-bottom: 1px solid #2a3a4a;
        flex-shrink: 0;
      }
      #mindease-overlay-header h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: #4EB8FF;
        letter-spacing: 0.04em;
      }
      #mindease-overlay-close {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 1.2rem;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
      }
      #mindease-overlay-close:hover {
        color: #f0f4f8;
        background: rgba(255,255,255,0.1);
      }
      #mindease-overlay-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
      }
      #mindease-overlay-body .chunk {
        margin-bottom: 16px;
        padding: 12px;
        background: #1a2332;
        border-radius: 8px;
        border: 1px solid #2a3a4a;
      }
      #mindease-overlay-body .chunk p {
        margin: 0 0 4px;
        color: #f0f4f8;
      }
      #mindease-overlay-body .chunk .concept {
        color: #4EB8FF;
        font-weight: 500;
        font-size: 0.8rem;
      }
    </style>
    <div id="mindease-overlay-header">
      <h2>MindEase — Simplified View</h2>
      <button id="mindease-overlay-close" aria-label="Close">✕</button>
    </div>
    <div id="mindease-overlay-body">
      ${chunks.map((c) => {
        const hasConcept = c.text.includes("[CONCEPT:");
        const cleanText = c.text.replace(/\[CONCEPT:[^\]]+\]/g, "").trim();
        const conceptMatch = c.text.match(/\[CONCEPT:\s*([^\]]+)\]/);
        const conceptTag = conceptMatch ? conceptMatch[1].trim() : "";
        return `
          <div class="chunk">
            ${conceptTag ? `<p class="concept">✦ ${conceptTag}</p>` : ""}
            <p>${hasConcept ? cleanText : c.text}</p>
          </div>
        `;
      }).join("")}
    </div>
  `;

  document.body.appendChild(overlay);

  /* Bind close button */
  document.getElementById("mindease-overlay-close")?.addEventListener("click", () => {
    overlay.remove();
  });
}
