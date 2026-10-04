import { getSession } from "@/utils/supabase";
import browser from "webextension-polyfill";
import {
  STORAGE_KEYS,
  type StorageDestinationConfig,
  type StorageDestinationType,
  type SessionFolderSummary,
} from "@/types";

export type { StorageDestinationConfig, StorageDestinationType, SessionFolderSummary };

export const DEFAULT_STORAGE_CONFIG: StorageDestinationConfig = {
  destination: "local",
  localPath: "MindEase/Lessons",
  updatedAt: Date.now(),
};

/** Load the user's storage destination choice and folder path. */
export async function getStorageConfig(): Promise<StorageDestinationConfig> {
  const result = await browser.storage.local.get(STORAGE_KEYS.STORAGE_DESTINATION);
  const cfg = result[STORAGE_KEYS.STORAGE_DESTINATION] as Partial<StorageDestinationConfig> | undefined;
  return {
    ...DEFAULT_STORAGE_CONFIG,
    ...cfg,
  };
}

/** Update destination ("local" | "supabase") and/or custom local folder path. */
export async function saveStorageConfig(update: Partial<StorageDestinationConfig>): Promise<StorageDestinationConfig> {
  const current = await getStorageConfig();
  const next: StorageDestinationConfig = {
    ...current,
    ...update,
    updatedAt: Date.now(),
  };
  await browser.storage.local.set({ [STORAGE_KEYS.STORAGE_DESTINATION]: next });
  return next;
}

function isSessionFolder(value: unknown): value is SessionFolderSummary {
  if (!value || typeof value !== "object") return false;
  return "sessionId" in value && typeof value.sessionId === "string" &&
    "sessionNumber" in value && typeof value.sessionNumber === "number" &&
    "dateStr" in value && typeof value.dateStr === "string" &&
    "folderName" in value && typeof value.folderName === "string" &&
    "title" in value && typeof value.title === "string" &&
    "durationMs" in value && typeof value.durationMs === "number" &&
    "conceptCount" in value && typeof value.conceptCount === "number" &&
    "focusScore" in value && typeof value.focusScore === "number" &&
    "savedAt" in value && typeof value.savedAt === "number" &&
    "destination" in value && (value.destination === "local" || value.destination === "supabase") &&
    "videos" in value && Array.isArray(value.videos) &&
    value.videos.every(v => v && typeof v.id === "string" && typeof v.concept === "string" &&
      typeof v.filename === "string" && typeof v.videoUrl === "string") &&
    "visuals" in value && Array.isArray(value.visuals) &&
    value.visuals.every(v => v && typeof v.id === "string" && typeof v.concept === "string" &&
      typeof v.filename === "string" && typeof v.dataUrl === "string") &&
    "history" in value && !!value.history && typeof value.history === "object" &&
    "topic" in value.history && typeof value.history.topic === "string" &&
    "concepts" in value.history && Array.isArray(value.history.concepts) &&
    value.history.concepts.every(c => typeof c === "string") &&
    "timeSpentMinutes" in value.history && typeof value.history.timeSpentMinutes === "number" &&
    "notesCount" in value.history && typeof value.history.notesCount === "number" &&
    "summaryText" in value.history && typeof value.history.summaryText === "string";
}

async function localSessionFolders(): Promise<SessionFolderSummary[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_FOLDERS);
  const value = result[STORAGE_KEYS.SESSION_FOLDERS];
  return Array.isArray(value) ? value.filter(isSessionFolder) : [];
}

/** Merge local archives with the signed-in account's cloud archives. */
export async function getSessionFolders(): Promise<SessionFolderSummary[]> {
  const folders = new Map((await localSessionFolders()).map(folder => [folder.sessionId, folder]));
  try {
    const session = await getSession();
    const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (session && url && key) {
      const response = await fetch(`${url}/rest/v1/session_folders?user_id=eq.${encodeURIComponent(session.user.id)}&select=summary`, {
        headers: { apikey: key, Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) throw new Error(`Cloud archive retrieval failed (${response.status}).`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error("Cloud archive response is invalid.");
      for (const row of rows) {
        if (!row || !isSessionFolder(row.summary)) continue;
        const previous = folders.get(row.summary.sessionId);
        if (!previous || row.summary.savedAt > previous.savedAt) folders.set(row.summary.sessionId, row.summary);
      }
    }
  } catch (error) {
    console.warn("[MindEase] Cloud archives unavailable; showing local archives:", error);
  }
  return [...folders.values()].sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSessionFolder(sessionId: string): Promise<void> {
  const session = await getSession();
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (session && url && key) {
    const response = await fetch(`${url}/rest/v1/session_folders?user_id=eq.${encodeURIComponent(session.user.id)}&session_id=eq.${encodeURIComponent(sessionId)}`, {
      method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) throw new Error(`Cloud archive deletion failed (${response.status}).`);
  }
  const remaining = (await localSessionFolders()).filter(folder => folder.sessionId !== sessionId);
  await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: remaining });
}

/** Save a newly finished session as a structured folder. */
export async function recordSessionFolder(folder: SessionFolderSummary): Promise<void> {
  const list = await localSessionFolders();
  // Newest sessions first
  const existingIdx = list.findIndex((f) => f.sessionId === folder.sessionId);
  if (existingIdx >= 0) {
    list[existingIdx] = folder;
  } else {
    list.unshift(folder);
  }
  await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: list });

  // If destination is supabase and user is signed in, sync folder metadata to cloud
  if (folder.destination === "supabase") {
    try {
      const session = await getSession();
      if (session) {
        const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "");
        const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
        if (url && key) {
          const response = await fetch(`${url}/rest/v1/session_folders?on_conflict=user_id,session_id`, {
            method: "POST",
            headers: {
              apikey: key,
              Authorization: `Bearer ${session.accessToken}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates",
            },
            body: JSON.stringify({
              user_id: session.user.id,
              session_id: folder.sessionId,
              folder_name: folder.folderName,
              summary: folder,
              updated_at: new Date().toISOString(),
            }),
          });
          if (!response.ok) throw new Error(`Cloud folder synchronization failed (${response.status}).`);
        }
      }
    } catch (error) {
      console.warn("[MindEase] Archive saved locally but cloud synchronization failed:", error);
    }
  }
}

/** Export a local session folder as a downloadable JSON / file package */
export function downloadSessionSummary(folder: SessionFolderSummary, basePath: string) {
  const fullPath = `${basePath.replace(/\/+$/, "")}/${folder.folderName}`;
  const data = {
    folderPath: fullPath,
    ...folder,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folder.folderName}_summary.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
