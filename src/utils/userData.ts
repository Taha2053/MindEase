import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";

export const DELETED_SESSION_IDS_KEY = "mindease_deleted_session_ids";

const SECRET_KEYS = new Set<string>([STORAGE_KEYS.API_KEYS, STORAGE_KEYS.AUTH_SESSION]);
const PERSONAL_PREFIXES = ["session_", "artifact_", "mindease_feedback_"];
const PERSONAL_KEYS = new Set<string>([
  STORAGE_KEYS.PROFILE, STORAGE_KEYS.ONBOARDING_DONE, STORAGE_KEYS.QTABLE,
  STORAGE_KEYS.SESSION_STATS, STORAGE_KEYS.SESSION_CHUNKS, STORAGE_KEYS.WORKSPACE,
  STORAGE_KEYS.NOTES, STORAGE_KEYS.SESSION_HISTORY, STORAGE_KEYS.VISUALS_CACHE,
  STORAGE_KEYS.OVERRIDES, STORAGE_KEYS.EXPLANATIONS, STORAGE_KEYS.SESSION_FOLDERS,
  STORAGE_KEYS.RL_ADAPTATION_LOG, STORAGE_KEYS.ACTIVE_LAYER3_SESSION,
  STORAGE_KEYS.SESSION_ACTIVE, STORAGE_KEYS.EXCLUDED_TABS,
  "activeSession", "latestArtifact", "latestReviewChunks", "mindease_saved_videos",
  DELETED_SESSION_IDS_KEY, "mindease_video_draft",
]);
export function sanitizeUserData(all: Record<string, unknown>): Record<string, unknown> {
  const auth = all[STORAGE_KEYS.AUTH_SESSION];
  const currentUserId = (
    auth &&
    typeof auth === "object" &&
    "user" in auth &&
    auth.user &&
    typeof auth.user === "object" &&
    "id" in auth.user &&
    typeof auth.user.id === "string"
  ) ? auth.user.id : undefined;

  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(all)) {
    if (SECRET_KEYS.has(key)) continue;

    if (key === STORAGE_KEYS.SESSION_FOLDERS && Array.isArray(value)) {
      const filtered = value.filter(folder => {
        if (!folder || typeof folder !== "object") return false;
        const owner = "ownerAccountId" in folder ? folder.ownerAccountId : undefined;
        return !owner || owner === currentUserId;
      });
      entries.push([key, filtered]);
    } else {
      entries.push([key, value]);
    }
  }
  return Object.fromEntries(entries);
}

export function personalDataKeys(all: Record<string, unknown>): string[] {
  return Object.keys(all).filter(key => PERSONAL_KEYS.has(key) || PERSONAL_PREFIXES.some(prefix => key.startsWith(prefix)));
}

export async function exportUserData(): Promise<Record<string, unknown>> {
  const all = await browser.storage.local.get(null) as Record<string, unknown>;
  return { exportedAt: new Date().toISOString(), schemaVersion: 1, data: sanitizeUserData(all) };
}

export async function deleteAllUserData(): Promise<number> {
  const all = await browser.storage.local.get(null) as Record<string, unknown>;
  const keys = personalDataKeys(all);
  if (keys.length) await browser.storage.local.remove(keys);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("mindease-local");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other MindEase pages before deleting local data."));
  });
  return keys.length;
}
