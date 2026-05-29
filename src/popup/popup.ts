/* ============================================================
   popup/popup.ts — Extension popup panel logic
   Displays the current cognitive profile summary,
   session statistics, and controls (End Session, Reset Profile).
   Color palette: navy #0f1724, accent #4EB8FF, soft white.
   ============================================================ */

import browser from "webextension-polyfill";
import type { FullCognitiveProfile, SessionStats } from "@/types";
import { STORAGE_KEYS } from "@/types";

/* ── DOM references ──────────────────────────────────────────────────────────── */

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/* ── Render helpers ──────────────────────────────────────────────────────────── */

function renderProfile(profile: FullCognitiveProfile, stats: SessionStats): void {
  const titleEl = $("profile-title");
  const summaryEl = $("profile-summary");
  const paramsEl = $("transformation-params");
  const statsEl = $("session-stats");

  if (titleEl) {
    titleEl.textContent = `MindEase — ${profile.userId.slice(0, 8)}`;
  }

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="stat-row"><span class="stat-label">Format</span><span class="stat-value">${profile.baseline.formatPreference}</span></div>
      <div class="stat-row"><span class="stat-label">Attention</span><span class="stat-value">${profile.baseline.attentionSpan}</span></div>
      <div class="stat-row"><span class="stat-label">Reading Pace</span><span class="stat-value">${profile.baseline.readingPace}</span></div>
      <div class="stat-row"><span class="stat-label">Concept Anchor</span><span class="stat-value">${profile.baseline.needsConceptAnchor ? "Yes" : "No"}</span></div>
      <div class="stat-row"><span class="stat-label">Second Language</span><span class="stat-value">${profile.baseline.secondLanguageLearner ? "Yes" : "No"}</span></div>
      <div class="stat-row"><span class="stat-label">Sessions</span><span class="stat-value">${profile.rlState.sessionCount}</span></div>
      <div class="stat-row"><span class="stat-label">Engagement</span><span class="stat-value">${profile.rlState.totalEngagementScore.toFixed(1)}</span></div>
    `;
  }

  if (paramsEl) {
    const p = profile.transformationParams;
    paramsEl.innerHTML = `
      <div class="stat-row"><span class="stat-label">Chunk Size</span><span class="stat-value">${p.chunkSize}</span></div>
      <div class="stat-row"><span class="stat-label">Simplify Level</span><span class="stat-value">${p.simplificationLevel}</span></div>
      <div class="stat-row"><span class="stat-label">Caption Speed</span><span class="stat-value">${p.captionSpeed}</span></div>
      <div class="stat-row"><span class="stat-label">Visual Anchors</span><span class="stat-value">${p.useVisualAnchors ? "On" : "Off"}</span></div>
      <div class="stat-row"><span class="stat-label">Summary Freq</span><span class="stat-value">${p.summaryFrequency}</span></div>
    `;
  }

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-row highlight"><span class="stat-label">Highlights</span><span class="stat-value">${stats.totalHighlights}</span></div>
      <div class="stat-row"><span class="stat-label">Pauses</span><span class="stat-value">${stats.totalPauses}</span></div>
      <div class="stat-row skip"><span class="stat-label">Skips</span><span class="stat-value">${stats.totalSkips}</span></div>
      <div class="stat-row"><span class="stat-label">Engaged Sections</span><span class="stat-value">${stats.engagedSections.length}</span></div>
      <div class="stat-row"><span class="stat-label">Skipped Sections</span><span class="stat-value">${stats.skippedSections.length}</span></div>
    `;
  }
}

function renderEmpty(): void {
  const titleEl = $("profile-title");
  const summaryEl = $("profile-summary");
  const paramsEl = $("transformation-params");
  const statsEl = $("session-stats");

  if (titleEl) titleEl.textContent = "MindEase";
  if (summaryEl) summaryEl.innerHTML = `<p class="empty-state">No profile yet. Complete onboarding to start.</p>`;
  if (paramsEl) paramsEl.innerHTML = "";
  if (statsEl) statsEl.innerHTML = "";
}

/* ── Actions ─────────────────────────────────────────────────────────────────── */

async function handleEndSession(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: "SESSION_END" });
    const statusEl = $("status-message");
    if (statusEl) {
      statusEl.textContent = "Session ended!";
      statusEl.className = "status success";
    }
  } catch {
    /* ignore */
  }
}

async function handleResetProfile(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: "RESET_PROFILE" });
    /* Reopen onboarding */
    await browser.tabs.create({
      url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"),
      active: true,
    });
    renderEmpty();
  } catch {
    /* ignore */
  }
}

/* ── Init ────────────────────────────────────────────────────────────────────── */

async function init(): Promise<void> {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.PROFILE,
    STORAGE_KEYS.SESSION_STATS,
  ]);

  const profile = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
  const stats = result[STORAGE_KEYS.SESSION_STATS] as SessionStats | undefined ?? {
    engagedSections: [],
    skippedSections: [],
    totalHighlights: 0,
    totalPauses: 0,
    totalSkips: 0,
    dominantSignal: "pause" as const,
  };

  if (profile) {
    renderProfile(profile, stats);
  } else {
    renderEmpty();
  }

  /* Bind buttons */
  $("end-session-btn")?.addEventListener("click", handleEndSession);
  $("reset-profile-btn")?.addEventListener("click", handleResetProfile);
}

init();
