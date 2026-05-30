/* ─── MindEase — Layer 2: Profile Manager ───
     CRUD operations for the cognitive profile stored
     in browser.storage.local (cross-browser via webextension-polyfill).
     Consumed by the RL agent and exposed to Layers 1 & 3.
  ───────────────────────────────────────────────────────────── */

import browser from "webextension-polyfill";
import type {
  FullCognitiveProfile,
  BaselineProfile,
  RLState,
  TransformationParams,
  SessionStats,
  QTable,
} from "@/types";
import {
  STORAGE_KEYS,
  ACTION_COUNT,
} from "@/types";

/* ─── UUID Generator ─── */
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ─── Default RL State ─── */
function defaultRLState(): RLState {
  return {
    highlightRate: 0,
    pauseRate: 0,
    reReadRate: 0,
    skipRate: 0,
    sessionCount: 0,
    totalEngagementScore: 0,
  };
}

/* ─── Baseline → Initial Transformation Params ─── */
function initialTransformationParams(baseline: BaselineProfile): TransformationParams {
  let chunkSize: TransformationParams["chunkSize"] = "medium";
  let simplificationLevel: TransformationParams["simplificationLevel"] = 2;
  let captionSpeed: TransformationParams["captionSpeed"] = "normal";
  let useVisualAnchors: TransformationParams["useVisualAnchors"] = baseline.formatPreference === "visual";
  let summaryFrequency: TransformationParams["summaryFrequency"] = "medium";

  if (baseline.attentionSpan === "short") {
    chunkSize = "small";
    summaryFrequency = "high";
  } else if (baseline.attentionSpan === "long") {
    chunkSize = "large";
    summaryFrequency = "low";
  }

  if (baseline.readingPace === "slow") {
    captionSpeed = "slow";
    simplificationLevel = 3;
  } else if (baseline.readingPace === "fast") {
    captionSpeed = "fast";
    simplificationLevel = 1;
  }

  if (baseline.secondLanguageLearner) {
    const nextLevel = Math.min(3, simplificationLevel + 1) as TransformationParams["simplificationLevel"];
    simplificationLevel = nextLevel;
    captionSpeed = "slow";
  }

  if (baseline.infoDensity === "concise") {
    chunkSize = chunkSize === "large" ? "medium" : "small";
    summaryFrequency = "high";
  }

  if (baseline.learningApproach === "example-first") {
    useVisualAnchors = true;
    simplificationLevel = Math.min(3, simplificationLevel + 1) as TransformationParams["simplificationLevel"];
  }

  return { chunkSize, simplificationLevel, captionSpeed, useVisualAnchors, summaryFrequency };
}

/* ─── Profile CRUD ─── */

export async function createProfile(baseline: BaselineProfile): Promise<FullCognitiveProfile> {
  const now = new Date().toISOString();
  const profile: FullCognitiveProfile = {
    userId: generateUUID(),
    learningStyle: baseline.formatPreference === "visual" ? "visual" : "text",
    attentionSpan: baseline.attentionSpan,
    anchorNeed: baseline.needsConceptAnchor,
    condition: baseline.secondLanguageLearner ? "multilingual" : "none",
    updatedAt: Date.now(),
    createdAt: now,
    baseline,
    rlState: defaultRLState(),
    transformationParams: initialTransformationParams(baseline),
  };

  await browser.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile });
  return profile;
}

export async function getProfile(): Promise<FullCognitiveProfile | null> {
  const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
  return (result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile) ?? null;
}

export async function updateProfile(profile: FullCognitiveProfile): Promise<void> {
  profile.updatedAt = Date.now();
  await browser.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile });
}

export async function deleteProfile(): Promise<void> {
  await browser.storage.local.remove([
    STORAGE_KEYS.PROFILE,
    STORAGE_KEYS.QTABLE,
    STORAGE_KEYS.ONBOARDING_DONE,
    STORAGE_KEYS.SESSION_ACTIVE,
    STORAGE_KEYS.SESSION_STATS,
  ]);
}

/* ─── Q-table CRUD ─── */

export async function getQTable(): Promise<QTable> {
  const result = await browser.storage.local.get(STORAGE_KEYS.QTABLE);
  return (result[STORAGE_KEYS.QTABLE] as QTable) ?? {};
}

export async function saveQTable(qTable: QTable): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.QTABLE]: qTable });
}

/* ─── Session Stats CRUD ─── */

export function freshSessionStats(): SessionStats {
  return {
    engagedSections: [],
    skippedSections: [],
    totalHighlights: 0,
    totalPauses: 0,
    totalSkips: 0,
    dominantSignal: "pause",
  };
}

export async function getSessionStats(): Promise<SessionStats> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SESSION_STATS);
  return (result[STORAGE_KEYS.SESSION_STATS] as SessionStats) ?? freshSessionStats();
}

export async function saveSessionStats(stats: SessionStats): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.SESSION_STATS]: stats });
}

export async function clearSessionStats(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.SESSION_STATS);
}

/* ─── Onboarding Check ─── */

export async function isOnboardingDone(): Promise<boolean> {
  const result = await browser.storage.local.get(STORAGE_KEYS.ONBOARDING_DONE);
  return result[STORAGE_KEYS.ONBOARDING_DONE] === true;
}

/* ─── Notify Layers of Profile Update ─── */

export async function broadcastProfileUpdate(profile: FullCognitiveProfile): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: "PROFILE_UPDATED",
      payload: profile,
    });
  } catch {
    /* no listeners — that's ok */
  }
}
