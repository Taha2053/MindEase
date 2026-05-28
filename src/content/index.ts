// ============================================================
// content/index.ts — Content Script
// Runs inside every webpage the student visits.
// Detects content type, then activates the appropriate layer.
// ============================================================

import browser from "webextension-polyfill";

// Detect what kind of content this page contains
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
  // Default: treat as website
  return "website";
}

// Notify background that a new session source has been detected
function notifySessionStart(sourceType: string): void {
  browser.runtime.sendMessage({
    type: "SESSION_START",
    payload: {
      sourceType,
      url: window.location.href,
      timestamp: Date.now(),
    },
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

const sourceType = detectSourceType();

if (sourceType) {
  console.log(`[MindEase Content] Detected source: ${sourceType}`);
  notifySessionStart(sourceType);

  // Layer 1 (Rayhane) will hook in here to intercept and transform content
  // Layer 2 (Taha)    will hook in here to observe behavioral signals
  // Layer 3 (Eya)     receives those signals via background message routing
}
