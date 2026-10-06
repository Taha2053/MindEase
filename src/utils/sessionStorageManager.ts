import { getSession, type AuthSession } from "@/utils/supabase";
import { persistLocalProfile } from "@/utils/localDatabase";
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

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(name, fn);
  }
  return fn();
}

/**
 * Retrieve raw stored auth session identity from browser.storage.local without network refresh.
 * Preserves offline identity and archive ownership/visibility even when token has expired.
 */
export async function storedAuth(): Promise<AuthSession | null> {
  const result = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
  const session = result[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined;
  if (!session || !session.user || typeof session.user.id !== "string") return null;
  return session;
}

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
  if (update.destination === "supabase" && !(await storedAuth())) {
    update = { ...update, destination: "local" };
  }
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
  const initialAuth = await storedAuth();
  const localList = (await localSessionFolders())
    .filter(folder => !folder.ownerAccountId || folder.ownerAccountId === initialAuth?.user.id);
  const folders = new Map(localList.map(folder => [folder.sessionId, folder]));

  try {
    const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (initialAuth && url && key) {
      // Network getSession refresh only within sync/fetch catch
      const session = await getSession();
      if (session && session.user.id === initialAuth.user.id) {
        const response = await fetch(
          `${url}/rest/v1/session_folders?user_id=eq.${encodeURIComponent(session.user.id)}&select=summary`,
          {
            headers: { apikey: key, Authorization: `Bearer ${session.accessToken}` },
          }
        );
        if (!response.ok) throw new Error(`Cloud archive retrieval failed (${response.status}).`);
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error("Cloud archive response is invalid.");

        const downloadedFolders: SessionFolderSummary[] = [];
        for (const row of rows) {
          if (!row || !isSessionFolder(row.summary)) continue;
          const cloudFolder: SessionFolderSummary = {
            ...row.summary,
            ownerAccountId: initialAuth.user.id,
            syncState: "synced",
            syncError: undefined,
          };
          downloadedFolders.push(cloudFolder);

          const previous = folders.get(cloudFolder.sessionId);
          if (!previous) {
            folders.set(cloudFolder.sessionId, cloudFolder);
          } else if (previous.syncState !== "pending" && cloudFolder.savedAt > previous.savedAt) {
            folders.set(cloudFolder.sessionId, cloudFolder);
          }
        }

        // Cache downloaded cloud folders under existing mindease-session-folders lock
        // without overwriting newer/pending local or other accounts;
        // avoid redundant storage sets on unchanged reads (UI listeners).
        if (downloadedFolders.length > 0) {
          await withLock("mindease-session-folders", async () => {
            const currentList = await localSessionFolders();
            let hasChanges = false;
            const updatedList = [...currentList];

            for (const cloudFolder of downloadedFolders) {
              const existingIndex = updatedList.findIndex(
                item => item.sessionId === cloudFolder.sessionId && item.ownerAccountId === initialAuth.user.id
              );
              if (existingIndex < 0) {
                updatedList.push(cloudFolder);
                hasChanges = true;
              } else {
                const existing = updatedList[existingIndex];
                if (existing.syncState !== "pending" && cloudFolder.savedAt > existing.savedAt) {
                  updatedList[existingIndex] = cloudFolder;
                  hasChanges = true;
                }
              }
            }

            if (hasChanges) {
              await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: updatedList });
            }
          });
        }
      }
    }
  } catch (error) {
    console.warn("[MindEase] Cloud archives unavailable; showing local archives:", error);
  }

  // Verify raw stored account still same
  const currentAuth = await storedAuth();
  if (currentAuth?.user.id !== initialAuth?.user.id) return [];
  return [...folders.values()].sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSessionFolder(sessionId: string): Promise<void> {
  const auth = await storedAuth();
  const list = await localSessionFolders();
  const target = list.find(
    folder => folder.sessionId === sessionId && (!folder.ownerAccountId || folder.ownerAccountId === auth?.user.id)
  );

  // For local-only folder no remote call necessary
  const isLocalOnly = target ? (target.destination === "local" || !target.ownerAccountId) : false;

  if (!isLocalOnly && (target?.destination === "supabase" || (!target && auth))) {
    const session = await getSession();
    if (!session) throw new Error("Cloud archive deletion failed: Authentication required.");
    const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Cloud archive deletion failed: Supabase is not configured.");
    const response = await fetch(
      `${url}/rest/v1/session_folders?user_id=eq.${encodeURIComponent(session.user.id)}&session_id=eq.${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${session.accessToken}` },
      }
    );
    if (!response.ok) throw new Error(`Cloud archive deletion failed (${response.status}).`);
  }

  await withLock("mindease-session-folders", async () => {
    const currentList = await localSessionFolders();
    const remaining = currentList.filter(folder =>
      folder.sessionId !== sessionId || (folder.ownerAccountId && folder.ownerAccountId !== auth?.user.id)
    );
    await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: remaining });
  });
  await persistLocalProfile();
}

/** Save a newly finished session as a structured folder. */
export async function recordSessionFolder(folder: SessionFolderSummary): Promise<void> {
  // Record auth currently before network: no late account identity drift.
  // Keep folder.ownerAccountId existing or raw snapshot.
  const auth = await storedAuth();
  const ownerAccountId = folder.ownerAccountId !== undefined
    ? folder.ownerAccountId
    : (auth?.user.id ?? null);

  let saved: SessionFolderSummary = {
    ...folder,
    ownerAccountId,
    syncState: folder.destination === "supabase" ? "pending" : "local",
    syncError: undefined,
  };

  await withLock("mindease-session-folders", async () => {
    const list = await localSessionFolders();
    const index = list.findIndex(
      item => item.sessionId === saved.sessionId && item.ownerAccountId === saved.ownerAccountId
    );
    if (index >= 0) {
      const prior = list[index];
      // Merge unique prior + incoming visuals by id
      const visualMap = new Map<string, (typeof saved.visuals)[number]>();
      for (const v of prior.visuals ?? []) {
        if (v && v.id) visualMap.set(v.id, v);
      }
      for (const v of saved.visuals ?? []) {
        if (v && v.id) visualMap.set(v.id, v);
      }

      // Merge unique prior + incoming videos by id
      const videoMap = new Map<string, (typeof saved.videos)[number]>();
      for (const v of prior.videos ?? []) {
        if (v && v.id) videoMap.set(v.id, v);
      }
      for (const v of saved.videos ?? []) {
        if (v && v.id) videoMap.set(v.id, v);
      }

      // Incoming fields canonical, visuals/videos merged
      saved = {
        ...prior,
        ...saved,
        visuals: [...visualMap.values()],
        videos: [...videoMap.values()],
      };
      list[index] = saved;
    } else {
      list.unshift(saved);
    }
    await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: list });
  });

  await persistLocalProfile();

  if (saved.destination === "supabase") {
    try {
      await syncSessionFolders();
    } catch (err) {
      console.warn("[MindEase] Background sync after record failed:", err);
    }
  }
}

/** Retry only archives owned by this account; device-local data is never silently uploaded. */
export async function syncSessionFolders(): Promise<void> {
  const auth = await storedAuth();
  if (!auth) return;

  await withLock("mindease-session-folder-sync", async () => {
    const currentAuth = await storedAuth();
    if (currentAuth?.user.id !== auth.user.id) return;

    let session: AuthSession | null = null;
    let authError: string | undefined;
    try {
      session = await getSession();
      if (!session) {
        authError = "Authentication required. Your archive is saved on this device; retry sync.";
      }
    } catch (error) {
      authError = error instanceof Error
        ? `Authentication failed (${error.message}). Your archive is saved on this device; retry sync.`
        : "Authentication failed. Your archive is saved on this device; retry sync.";
    }

    if (!session || authError) {
      const retryDescription = authError || "Authentication failed. Your archive is saved on this device; retry sync.";
      await withLock("mindease-session-folders", async () => {
        const latest = await localSessionFolders();
        let changed = false;
        for (const item of latest) {
          if (item.destination === "supabase" && item.ownerAccountId === auth.user.id && item.syncState === "pending") {
            item.syncState = "error";
            item.syncError = retryDescription;
            changed = true;
          }
        }
        if (changed) {
          await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: latest });
        }
      });
      return;
    }

    const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const folders = await localSessionFolders();
    for (const folder of folders) {
      if (folder.destination !== "supabase" || folder.ownerAccountId !== session.user.id || folder.syncState === "synced") continue;
      let syncError: string | undefined;
      try {
        if (!url || !key) throw new Error("Supabase is not configured. The archive remains saved on this device.");
        const current = await getSession();
        if (current?.user.id !== session.user.id) return;
        const response = await fetch(`${url}/rest/v1/session_folders?on_conflict=user_id,session_id`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${current.accessToken}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            user_id: session.user.id,
            session_id: folder.sessionId,
            folder_name: folder.folderName,
            summary: { ...folder, syncState: "synced", syncError: undefined },
            updated_at: new Date().toISOString(),
          }),
        });
        if (!response.ok) {
          throw new Error(`Cloud save failed (${response.status}). Your archive is saved on this device; retry sync.`);
        }
      } catch (error) {
        syncError = error instanceof Error ? error.message : "Cloud save failed. Retry sync.";
      }
      await withLock("mindease-session-folders", async () => {
        const latest = await localSessionFolders();
        const stored = latest.find(item => item.sessionId === folder.sessionId && item.ownerAccountId === session.user.id);
        if (!stored || stored.savedAt !== folder.savedAt) return;
        stored.syncState = syncError ? "error" : "synced";
        stored.syncError = syncError;
        await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: latest });
      });
    }
  });
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
