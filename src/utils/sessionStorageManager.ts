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

/** Get all saved session folders (local or cloud). */
export async function getSessionFolders(): Promise<SessionFolderSummary[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_FOLDERS);
  const list = result[STORAGE_KEYS.SESSION_FOLDERS] as SessionFolderSummary[] | undefined;
  return list ?? [];
}

/** Save a newly finished session as a structured folder. */
export async function recordSessionFolder(folder: SessionFolderSummary): Promise<void> {
  const list = await getSessionFolders();
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
          await fetch(`${url}/rest/v1/session_folders?on_conflict=user_id,session_id`, {
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
          }).catch((err) => console.warn("[MindEase] Cloud folder sync error:", err));
        }
      }
    } catch {
      // Non-blocking
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
