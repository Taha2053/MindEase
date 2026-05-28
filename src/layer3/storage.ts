// ============================================================
// layer3/storage.ts — Chrome Storage Wrapper
// Handles all read/write operations for Layer 3 data.
// Uses chrome.storage.local for persistence across sessions.
// ============================================================

import browser from "webextension-polyfill";
import type { SessionLog, KnowledgeArtifact } from "@/types";

// ── Session Log ───────────────────────────────────────────────────────────────

/** Save the current session log to storage */
export async function saveSessionLog(log: SessionLog): Promise<void> {
  await browser.storage.local.set({ [`session_${log.sessionId}`]: log });
}

/** Load a session log by session ID */
export async function loadSessionLog(sessionId: string): Promise<SessionLog | null> {
  const result = await browser.storage.local.get(`session_${sessionId}`);
  return (result[`session_${sessionId}`] as SessionLog) ?? null;
}

/** Save the active (in-progress) session separately for fast access */
export async function saveActiveSession(log: SessionLog): Promise<void> {
  await browser.storage.local.set({ activeSession: log });
}

/** Load the currently active session */
export async function loadActiveSession(): Promise<SessionLog | null> {
  const result = await browser.storage.local.get("activeSession");
  return (result.activeSession as SessionLog) ?? null;
}

/** Clear the active session (called when session ends) */
export async function clearActiveSession(): Promise<void> {
  await browser.storage.local.remove("activeSession");
}

// ── Knowledge Artifacts ───────────────────────────────────────────────────────

/** Save a completed knowledge artifact */
export async function saveArtifact(artifact: KnowledgeArtifact): Promise<void> {
  // Save indexed by sessionId for history
  await browser.storage.local.set({
    [`artifact_${artifact.sessionId}`]: artifact,
    // Also keep a pointer to the most recent artifact for the popup
    latestArtifact: artifact,
  });
}

/** Load the most recent artifact */
export async function loadLatestArtifact(): Promise<KnowledgeArtifact | null> {
  const result = await browser.storage.local.get("latestArtifact");
  return (result.latestArtifact as KnowledgeArtifact) ?? null;
}

/** Load all past artifacts for the dashboard / progression view */
export async function loadAllArtifacts(): Promise<KnowledgeArtifact[]> {
  const all = await browser.storage.local.get(null); // get everything
  return Object.entries(all)
    .filter(([key]) => key.startsWith("artifact_"))
    .map(([, value]) => value as KnowledgeArtifact)
    .sort((a, b) => b.generatedAt - a.generatedAt); // newest first
}
