import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";

const SECRET_KEYS = new Set<string>([STORAGE_KEYS.API_KEYS, STORAGE_KEYS.AUTH_SESSION]);
const PERSONAL_PREFIXES = ["session_", "artifact_", "mindease_feedback_"];
const PERSONAL_KEYS = new Set<string>([
  STORAGE_KEYS.PROFILE, STORAGE_KEYS.ONBOARDING_DONE, STORAGE_KEYS.QTABLE,
  STORAGE_KEYS.SESSION_STATS, STORAGE_KEYS.SESSION_CHUNKS, STORAGE_KEYS.WORKSPACE,
  STORAGE_KEYS.NOTES, STORAGE_KEYS.SESSION_HISTORY, STORAGE_KEYS.VISUALS_CACHE,
  STORAGE_KEYS.OVERRIDES, "activeSession", "latestArtifact",
]);

export function sanitizeUserData(all: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(all).filter(([key]) => !SECRET_KEYS.has(key)));
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
  return keys.length;
}
