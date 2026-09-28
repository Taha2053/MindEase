import { getStorageConfig, recordSessionFolder } from "@/utils/sessionStorageManager";
import type { VisualEntry, SessionFolderSummary } from "@/types";
import browser from "webextension-polyfill";
import type { SessionHistoryEntry, KeyConceptEntry, FocusMetrics, ResourceEntry, FullCognitiveProfile } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { deleteFeedback } from "./feedback";
import { syncNow } from "@/utils/supabase";

/**
 * Build a deterministic, human-readable session name from source data.
 *
 * Priority:
 *   1. Resource titles (actual page/document titles the user visited)
 *   2. Cleaned concept labels from Layer 1 concept tags
 *   3. Date-based fallback
 *
 * Avoids LLM-generated fragments or malformed substrings by filtering
 * candidates through basic sanity checks.
 */
function generateAutoName(
  concepts: KeyConceptEntry[],
  endTime: number,
  resources: ResourceEntry[],
): string {
  // ── Try resource titles first (ground truth: actual page titles) ──────────
  const meaningfulTitles = resources
    .map(r => r.title)
    .filter(t => t && t.length > 2 && !looksLikeUrl(t))
    .map(t => (t.split(/\s+[-|–—]\s+/)[0] || t).trim().replace(/\s+/g, " "));

  if (meaningfulTitles.length > 0) {
    // Use the first meaningful title, trimmed
    const primary = truncLabel(meaningfulTitles[0], 50);
    if (meaningfulTitles.length > 1) {
      return `Study: ${primary} (+${meaningfulTitles.length - 1} more)`;
    }
    return `Study: ${primary}`;
  }

  // ── Fall back to cleaned concept labels ───────────────────────────────────
  const cleanConcepts = concepts
    .map(c => c.label)
    .filter(isValidConceptLabel)
    .map(l => l.charAt(0).toUpperCase() + l.slice(1));

  if (cleanConcepts.length > 0) {
    const primary = truncLabel(cleanConcepts[0], 40);
    if (cleanConcepts.length > 1) {
      return `Study: ${primary} & ${truncLabel(cleanConcepts[1], 25)}`;
    }
    return `Study: ${primary}`;
  }

  // ── Date fallback ─────────────────────────────────────────────────────────
  const d = new Date(endTime);
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Session - ${dateStr}`;
}

/** Returns true if the string looks like a bare URL rather than a title */
function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^www\./i.test(s);
}


/** Truncate a label with an ellipsis if too long */
function truncLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  const lastBoundary = s.lastIndexOf(" ", max);
  return lastBoundary > 12 ? `${s.slice(0, lastBoundary)}…` : s;
}

/**
 * Filter out malformed concept labels:
 * - too short (<2 chars) or too long (>80 chars)
 * - looks like a code fragment or URL
 * - has excessive punctuation or non-alphabetic chars
 */
function isValidConceptLabel(label: string): boolean {
  if (label.length < 2 || label.length > 80) return false;
  // Reject labels that look like code/HTML/URLs
  if (/[{}<>\/\\=;]/.test(label)) return false;
  if (looksLikeUrl(label)) return false;
  const alpha = label.match(/\p{L}/gu)?.length ?? 0;
  if (alpha / label.length < 0.5) return false;
  return true;
}

export async function saveSessionHistory(
  sessionId: string,
  endTime: number,
  durationMs: number,
  concepts: KeyConceptEntry[],
  focusScore: number,
  resources: ResourceEntry[],
): Promise<void> {
  const name = generateAutoName(concepts, endTime, resources);
  const storedProfile = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
  const profile = storedProfile[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
  const entry: SessionHistoryEntry = {
    sessionId,
    name,
    endTime,
    durationMs,
    conceptCount: concepts.length,
    focusScore,
    resourceCount: resources.length,
    ...(profile ? { profileSnapshot: { baseline: profile.baseline, transformationParams: profile.transformationParams, updatedAt: profile.updatedAt } } : {}),
  };

  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  const history = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
  history.unshift(entry); // newest first

  // cap at 100 sessions to avoid unbounded storage growth
  const trimmed = history.slice(0, 100);
  await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: trimmed });

  // Package structured session folder (Date + Session Number / Videos, Visuals, History)
  try {
    const cfg = await getStorageConfig();
    const cachedVisuals = await browser.storage.local.get(STORAGE_KEYS.VISUALS_CACHE);
    const visualsList = ((cachedVisuals[STORAGE_KEYS.VISUALS_CACHE] as { entries?: VisualEntry[] })?.entries ?? []);
    const cachedVideos = await browser.storage.local.get("mindease_saved_videos");
    const videosList = (cachedVideos.mindease_saved_videos ?? []) as Array<{ id: string; concept: string; video_url: string; title?: string }>;

    const dateObj = new Date(endTime);
    const dateStr = dateObj.toISOString().slice(0, 10); // YYYY-MM-DD
    const sessionNum = history.length + 1;
    const folderName = `${dateStr}_Session-${String(sessionNum).padStart(2, "0")}`;

    const folderSummary: SessionFolderSummary = {
      sessionId,
      sessionNumber: sessionNum,
      dateStr,
      folderName,
      title: name,
      durationMs,
      conceptCount: concepts.length,
      focusScore,
      destination: cfg.destination,
      savedAt: endTime,
      videos: videosList.map((v, i) => ({
        id: v.id,
        concept: v.concept || `Scene ${i + 1}`,
        filename: `videos/scene_${i + 1}.mp4`,
        videoUrl: v.video_url,
      })),
      visuals: visualsList.map((vis, i) => ({
        id: vis.id,
        concept: vis.concept || `Diagram ${i + 1}`,
        filename: `visuals/diagram_${i + 1}.png`,
        dataUrl: vis.dataUrl,
      })),
      history: {
        topic: name,
        concepts: concepts.map((c) => c.label),
        timeSpentMinutes: Math.round(durationMs / 60000),
        notesCount: resources.reduce((acc, r) => acc + (r.notesCount ?? 0), 0),
        summaryText: `Studied ${concepts.length} key concepts across ${resources.length} learning resources.`,
      },
    };

    await recordSessionFolder(folderSummary);
  } catch (err) {
    console.warn("[MindEase] Session folder packaging failed:", err);
  }
  await syncNow().catch(() => {});
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
    await syncNow().catch(() => {});
  }
}

export async function deleteSessionEntry(sessionId: string): Promise<void> {
  await deleteFeedback(sessionId);
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  const history = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
  const filtered = history.filter(e => e.sessionId !== sessionId);
  await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: filtered });
  await syncNow().catch(() => {});

  // Also clean up the artifact and session log
  await browser.storage.local.remove([`artifact_${sessionId}`, `session_${sessionId}`]);
}
