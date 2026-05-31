/* ============================================================
   layer2/userControls.ts — User Content Controls
   Owner: Taha

   Gives users manual control over content adaptation parameters.
   Overrides take precedence over RL agent decisions — the user
   always has the final say.
   ============================================================ */

import browser from "webextension-polyfill";
import type {
  FullCognitiveProfile,
  UserOverrides,
  ChunkSize,
  SimplificationLevel,
  CaptionSpeed,
  SummaryFrequency,
} from "@/types";
import { STORAGE_KEYS } from "@/types";

// ── Default state (no overrides) ─────────────────────────────────────────────

function defaultOverrides(): UserOverrides {
  return {
    enabled: false,
    updatedAt: 0,
  };
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Load user overrides from storage.
 */
export async function loadOverrides(): Promise<UserOverrides> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.OVERRIDES);
    return (result[STORAGE_KEYS.OVERRIDES] as UserOverrides) ?? defaultOverrides();
  } catch {
    return defaultOverrides();
  }
}

/**
 * Save user overrides to storage.
 */
export async function saveOverrides(overrides: UserOverrides): Promise<void> {
  overrides.updatedAt = Date.now();
  await browser.storage.local.set({ [STORAGE_KEYS.OVERRIDES]: overrides });
}

/**
 * Clear all user overrides — resume full RL agent control.
 */
export async function clearOverrides(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.OVERRIDES);
}

/**
 * Set a single override value while preserving others.
 */
export async function setOverride<
  K extends keyof UserOverrides,
  V extends UserOverrides[K],
>(key: K, value: V): Promise<void> {
  const current = await loadOverrides();
  current.enabled = true;
  (current as unknown as Record<string, unknown>)[key] = value;
  await saveOverrides(current);
}

/**
 * Remove a single override — that param goes back to RL control.
 */
export async function clearSingleOverride(key: keyof UserOverrides): Promise<void> {
  const current = await loadOverrides();
  delete current[key];
  // If no individual overrides remain, disable the whole thing
  const hasAny = ["chunkSize", "simplificationLevel", "captionSpeed", "useVisualAnchors", "summaryFrequency"]
    .some(k => (current as unknown as Record<string, unknown>)[k] !== undefined);
  if (!hasAny) {
    current.enabled = false;
  }
  await saveOverrides(current);
}

// ── Apply overrides to profile ───────────────────────────────────────────────

/**
 * Merge user overrides on top of the RL agent's transformation params.
 * Called after every RL adaptation so user choices always win.
 * Returns a new params object — does not mutate the original.
 */
export function applyOverridesToParams(
  params: FullCognitiveProfile["transformationParams"],
  overrides: UserOverrides,
): FullCognitiveProfile["transformationParams"] {
  if (!overrides.enabled) return { ...params };

  const result = { ...params };

  if (overrides.chunkSize !== undefined) {
    result.chunkSize = overrides.chunkSize;
  }
  if (overrides.simplificationLevel !== undefined) {
    result.simplificationLevel = overrides.simplificationLevel;
  }
  if (overrides.captionSpeed !== undefined) {
    result.captionSpeed = overrides.captionSpeed;
  }
  if (overrides.useVisualAnchors !== undefined) {
    result.useVisualAnchors = overrides.useVisualAnchors;
  }
  if (overrides.summaryFrequency !== undefined) {
    result.summaryFrequency = overrides.summaryFrequency;
  }

  return result;
}

/**
 * Check if a specific param is currently user-overridden.
 */
export function isOverridden(
  overrides: UserOverrides,
  key: keyof FullCognitiveProfile["transformationParams"],
): boolean {
  if (!overrides.enabled) return false;
  return (overrides as unknown as Record<string, unknown>)[key] !== undefined;
}

/**
 * Get human-friendly label for each override value.
 */
export function paramLabel(
  key: keyof FullCognitiveProfile["transformationParams"],
  value: string | boolean | number,
): string {
  switch (key) {
    case "chunkSize":
      return value === "small" ? "Small" : value === "medium" ? "Medium" : "Large";
    case "simplificationLevel":
      return value === 3 ? "Simplest" : value === 2 ? "Moderate" : "Original";
    case "captionSpeed":
      return value === "slow" ? "Slow" : value === "normal" ? "Normal" : "Fast";
    case "useVisualAnchors":
      return value ? "On" : "Off";
    case "summaryFrequency":
      return value === "low" ? "Few" : value === "medium" ? "Moderate" : "Often";
    default:
      return String(value);
  }
}

/**
 * Get all possible values for a given param key.
 */
export function paramOptions(key: keyof FullCognitiveProfile["transformationParams"]): (string | boolean | number)[] {
  switch (key) {
    case "chunkSize":           return ["small", "medium", "large"];
    case "simplificationLevel": return [3, 2, 1];
    case "captionSpeed":        return ["slow", "normal", "fast"];
    case "useVisualAnchors":    return [true, false];
    case "summaryFrequency":    return ["high", "medium", "low"];
    default:                    return [];
  }
}
