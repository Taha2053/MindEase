import browser from "webextension-polyfill";
import type { SessionHistoryEntry, KeyConceptEntry, FocusMetrics, ResourceEntry } from "@/types";
import { STORAGE_KEYS } from "@/types";

function generateAutoName(
  concepts: KeyConceptEntry[],
  endTime: number,
): string {
  if (concepts.length > 0) {
    const top = concepts[0].label;
    const capitalized = top.charAt(0).toUpperCase() + top.slice(1);
    return `Study: ${capitalized}`;
  }
  const d = new Date(endTime);
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Session - ${dateStr}`;
}

export async function saveSessionHistory(
  sessionId: string,
  endTime: number,
  durationMs: number,
  concepts: KeyConceptEntry[],
  focusScore: number,
  resources: ResourceEntry[],
): Promise<void> {
  const name = generateAutoName(concepts, endTime);
  const entry: SessionHistoryEntry = {
    sessionId,
    name,
    endTime,
    durationMs,
    conceptCount: concepts.length,
    focusScore,
    resourceCount: resources.length,
  };

  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  const history = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
  history.unshift(entry); // newest first

  // cap at 100 sessions to avoid unbounded storage growth
  const trimmed = history.slice(0, 100);
  await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: trimmed });
}

export async function loadSessionHistory(): Promise<SessionHistoryEntry[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  return (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[]) ?? [];
}

export async function updateSessionName(sessionId: string, newName: string): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  const history = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
  const entry = history.find(e => e.sessionId === sessionId);
  if (entry) {
    entry.customName = newName;
    await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: history });
  }
}

export async function deleteSessionEntry(sessionId: string): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  const history = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
  const filtered = history.filter(e => e.sessionId !== sessionId);
  await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: filtered });

  // Also clean up the artifact and session log
  await browser.storage.local.remove([`artifact_${sessionId}`, `session_${sessionId}`]);
}
