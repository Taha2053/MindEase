import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";

export async function persistLocalProfile(): Promise<void> {
  await navigator.locks.request("mindease-local-profile", async () => {
    const data = await browser.storage.local.get(["mindease_installation_id", STORAGE_KEYS.PROFILE, STORAGE_KEYS.VISUALS_CACHE, "mindease_saved_videos"]);
    const installationId = data.mindease_installation_id as string | undefined ?? crypto.randomUUID();
    if (!data.mindease_installation_id) await browser.storage.local.set({ mindease_installation_id: installationId });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mindease-local", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("profiles", { keyPath: "installationId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("profiles", "readwrite");
        transaction.objectStore("profiles").put({ installationId, profile: data[STORAGE_KEYS.PROFILE], visuals: data[STORAGE_KEYS.VISUALS_CACHE], videos: data.mindease_saved_videos, updatedAt: Date.now() });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
}
