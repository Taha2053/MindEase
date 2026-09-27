import { getStorageConfig, recordSessionFolder } from "@/utils/sessionStorageManager";
import type { VisualEntry, SessionFolderSummary } from "@/types";
import browser from "webextension-polyfill";
import type { SessionHistoryEntry, KeyConceptEntry, FocusMetrics, ResourceEntry, FullCognitiveProfile } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { deleteFeedback } from "./feedback";
import { syncNow } from "@/utils/supabase";

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
