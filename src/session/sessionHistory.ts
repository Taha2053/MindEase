import { getStorageConfig, recordSessionFolder, deleteSessionFolder } from "@/utils/sessionStorageManager";
import type { VisualEntry, SessionFolderSummary, PersonalizedArtifact, ContentChunk } from "@/types";
import browser from "webextension-polyfill";
import type { SessionHistoryEntry, KeyConceptEntry, FocusMetrics, ResourceEntry, FullCognitiveProfile } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { deleteFeedback } from "./feedback";
import { syncNow } from "@/utils/supabase";
import { DELETED_SESSION_IDS_KEY } from "@/utils/userData";
/**
 * Format session name as the day and the time of day:
 * e.g. "Monday, Oct 5 at 10:12 PM"
 */
export function formatDayAndTime(timestamp: number): string {
  const d = new Date(timestamp);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${weekday} at ${time}`;
}

function generateAutoName(
  _concepts: KeyConceptEntry[],
  endTime: number,
  _resources: ResourceEntry[],
): string {
  return formatDayAndTime(endTime);
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

  const history = await navigator.locks.request("mindease-session-history", async () => {
    const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
    const previous = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
    const existing = previous.find(item => item.sessionId === sessionId);
    if (existing?.customName) {
      entry.customName = existing.customName;
    }
    const next = [entry, ...previous.filter(item => item.sessionId !== sessionId)].slice(0, 100);
    await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: next });
    return next;
  });

  // Package structured session folder (Date + Session Number / Videos, Visuals, History)
  try {
    const cfg = await getStorageConfig();
    const cachedVisuals = await browser.storage.local.get([
      STORAGE_KEYS.VISUALS_CACHE, `artifact_${sessionId}`, "latestReviewChunks",
    ]);
    const artifact = cachedVisuals[`artifact_${sessionId}`] as PersonalizedArtifact | undefined;
    const review = cachedVisuals.latestReviewChunks as { sessionId: string; chunks: ContentChunk[] } | undefined;
    const content = review?.sessionId === sessionId ? review.chunks : [];
    const startTime = endTime - durationMs;
    const cache = cachedVisuals[STORAGE_KEYS.VISUALS_CACHE] as { entries?: VisualEntry[] } | undefined;
    const visualsList: VisualEntry[] = (Array.isArray(cache?.entries) ? cache.entries : [])
      .filter((visual: VisualEntry) => {
        if ("sessionId" in visual && typeof visual.sessionId === "string") {
          return visual.sessionId === sessionId;
        }
        return visual.generatedAt >= startTime && visual.generatedAt <= endTime;
      });
    const cachedVideos = await browser.storage.local.get("mindease_saved_videos");
    const videosList = (cachedVideos.mindease_saved_videos ?? []) as Array<{ id: string; concept: string; video_url: string; title?: string; savedAt?: number; sessionId?: string }>;
    const sessionVideos = videosList.filter(video => {
      if ("sessionId" in video && typeof video.sessionId === "string") {
        return video.sessionId === sessionId;
      }
      return "savedAt" in video && typeof video.savedAt === "number" &&
        video.savedAt >= startTime && video.savedAt <= endTime;
    });
    const dateObj = new Date(endTime);
    const dateStr = dateObj.toISOString().slice(0, 10); // YYYY-MM-DD
    const sessionNum = history.filter(item => new Date(item.endTime).toISOString().slice(0, 10) === dateStr).length;
    const folderName = `${dateStr}_Session-${String(sessionNum).padStart(2, "0")}-${sessionId.slice(0, 8)}`;

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
      studyCards: artifact?.studyCards ?? [],
      content,
      resources,
      videos: sessionVideos.map((v, i) => ({
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
        summaryText: content.map(chunk => chunk.text).join("\n\n") || `Studied ${concepts.length} key concepts across ${resources.length} learning resources.`,
      },
    };

    await recordSessionFolder(folderSummary);
  } catch (err) {
    throw new Error(`Session summary was saved, but its study archive could not be saved: ${err instanceof Error ? err.message : String(err)}`);
  }
  await syncNow().catch(() => {});
}

export async function loadSessionHistory(): Promise<SessionHistoryEntry[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  return (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[]) ?? [];
}

export async function updateSessionName(sessionId: string, newName: string): Promise<void> {
  await navigator.locks.request("mindease-session-history", async () => {
    const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
    const history = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
    const entry = history.find(e => e.sessionId === sessionId);
    if (entry) {
      entry.customName = newName;
      await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: history });
    }
  });
  await syncNow().catch(() => {});
}

export async function deleteSessionEntry(sessionId: string): Promise<void> {
  await deleteSessionFolder(sessionId);
  await deleteFeedback(sessionId);
  await navigator.locks.request("mindease-session-history", async () => {
    const stored = await browser.storage.local.get([STORAGE_KEYS.SESSION_HISTORY, DELETED_SESSION_IDS_KEY]);
    const history = (stored[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
    const filtered = history.filter(e => e.sessionId !== sessionId);
    const deletedStored = (stored[DELETED_SESSION_IDS_KEY] as string[] | undefined) ?? [];
    const deletedIds = Array.from(new Set([...deletedStored, sessionId]));
    await browser.storage.local.set({
      [STORAGE_KEYS.SESSION_HISTORY]: filtered,
      [DELETED_SESSION_IDS_KEY]: deletedIds,
    });
  });
  await syncNow().catch(() => {});

  // Also clean up the artifact and session log
  await browser.storage.local.remove([`artifact_${sessionId}`, `session_${sessionId}`]);
}
