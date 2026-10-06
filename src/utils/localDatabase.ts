import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";
import { personalDataKeys } from "./userData";

/** Switch learner state with authentication under the caller's auth lock. */
export async function switchAccountData(nextAccountId: string | null): Promise<void> {
  const all = await browser.storage.local.get(null);
  const current = all[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined;
  const previousId = current?.user?.id ?? null;
  if (previousId === nextAccountId) return;
  const workspace = all[STORAGE_KEYS.WORKSPACE] as { state?: string; archivePending?: boolean } | undefined;
  if (workspace && (workspace.state !== "ended" || workspace.archivePending)) {
    throw new Error("End the current study session before switching accounts.");
  }
  const keys = personalDataKeys(all).filter(key => key !== STORAGE_KEYS.SESSION_FOLDERS);
  const snapshot = Object.fromEntries(keys.map(key => [key, all[key]]));
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mindease-local", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("profiles", { keyPath: "installationId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const restored = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const transaction = db.transaction("profiles", "readwrite");
      const store = transaction.objectStore("profiles");
      store.put({ installationId: `snapshot:${previousId ?? "local"}`, data: snapshot });
      const request = store.get(`snapshot:${nextAccountId ?? "local"}`);
      transaction.oncomplete = () => resolve(request.result?.data);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    // A first sign-in may adopt device-local preferences, never another account's.
    const next = restored ?? (previousId === null && nextAccountId !== null ? snapshot : {});
    await browser.storage.local.remove(keys);
    await browser.storage.local.set({
      ...next,
      [STORAGE_KEYS.SYNC_PREFERENCES]: { profile: false, history: false },
      [STORAGE_KEYS.EXTENSION_ACTIVE]: false,
    });
  } finally { db.close(); }
}

/** Device and account snapshots share one database but never the same record. */
export async function persistLocalProfile(): Promise<void> {
  await navigator.locks.request("mindease-local-profile", async () => {
    const data = await browser.storage.local.get([
      "mindease_installation_id", STORAGE_KEYS.AUTH_SESSION, STORAGE_KEYS.PROFILE,
      STORAGE_KEYS.VISUALS_CACHE, STORAGE_KEYS.SESSION_FOLDERS, STORAGE_KEYS.SESSION_HISTORY,
      "mindease_saved_videos",
    ]);
    const installationId = data.mindease_installation_id as string | undefined ?? crypto.randomUUID();
    if (!data.mindease_installation_id) await browser.storage.local.set({ mindease_installation_id: installationId });
    const auth = data[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mindease-local", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("profiles", { keyPath: "installationId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("profiles", "readwrite");
        transaction.objectStore("profiles").put({
          installationId: auth?.user?.id ? `account:${auth.user.id}` : installationId,
          machineId: installationId, accountId: auth?.user?.id ?? null,
          profile: data[STORAGE_KEYS.PROFILE], visuals: data[STORAGE_KEYS.VISUALS_CACHE],
          videos: data.mindease_saved_videos, folders: data[STORAGE_KEYS.SESSION_FOLDERS],
          history: data[STORAGE_KEYS.SESSION_HISTORY], updatedAt: Date.now(),
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
}
