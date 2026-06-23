/* ============================================================
   layer2/index.ts — Adaptive Cognitive Profiling
   Owner: Taha

   Responsibility:
     - 5-minute onboarding assessment
     - Build baseline cognitive profile
     - RL agent that reads behavioral signals
     - Update profile after every session
     - Send SESSION_END events to Layer 3
     - Expose GET_PROFILE API for Layers 1 & 3
   ============================================================ */

import browser from "webextension-polyfill";
import type {
  FullCognitiveProfile,
  BehaviorSignalMessage,
  SignalType,
  SessionStats,
  SessionEndPayload,
  BaselineProfile,
  CognitiveNeed,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import { RLAgent } from "./rlAgent";
import {
  createProfile,
  getProfile,
  updateProfile,
  deleteProfile,
  isOnboardingDone,
  getSessionStats,
  saveSessionStats,
  clearSessionStats,
  freshSessionStats,
  broadcastProfileUpdate,
} from "./profileManager";
import { generateExplanation, recordExplanation } from "./explainer";
import { loadOverrides, applyOverridesToParams } from "./userControls";

/* ─── Singleton RL Agent ─── */
let agent: RLAgent | null = null;

async function ensureAgent(): Promise<RLAgent> {
  if (!agent) {
    agent = new RLAgent();
    await agent.load();
  }
  return agent;
}

/* ─── Normalize signal type for Layer 3 ─── */
function normalizeEventType(signal: string): string {
  if (signal === "reRead") return "re-read";
  if (signal === "tabSwitch") return "pause";
  return signal;
}

/* ─── Emit a cognitive event to Layer 3 ─── */
export function emitCognitiveEvent(event: {
  type: string;
  contentChunkId: string;
  sourceId: string;
  sourceType: "pdf" | "website" | "video" | "lecture";
  timestamp: number;
  durationMs: number;
  profile: FullCognitiveProfile;
}): void {
  browser.runtime.sendMessage({
    type: "COGNITIVE_EVENT",
    payload: { ...event, type: normalizeEventType(event.type) },
  }).catch(() => {});
}

/* ─── Retrieve current profile ─── */
export async function getCurrentProfile(): Promise<FullCognitiveProfile | null> {
  return getProfile();
}

/* ─── Handle a behavior signal from content script ─── */
export async function handleBehaviorSignal(
  signal: SignalType,
  url: string,
  sectionId: string,
): Promise<void> {
  const profile = await getProfile();
  if (!profile) return;

  /* Update RL agent */
  const rlAgent = await ensureAgent();
  const { reward, updatedProfile, actionTaken } = await rlAgent.processSignal(profile, signal);

  /* Apply user overrides on top of RL params (user always wins) */
  const overrides = await loadOverrides();
  if (overrides.enabled) {
    updatedProfile.transformationParams = applyOverridesToParams(
      updatedProfile.transformationParams,
      overrides,
    );
  }

  /* Generate and store human-readable explanation for this adaptation */
  const explanation = generateExplanation(actionTaken, updatedProfile.rlState, updatedProfile.baseline, updatedProfile.transformationParams);
  await recordExplanation(explanation);

  /* Update session stats */
  const stats = await getSessionStats();
  if (signal === "highlight") {
    stats.totalHighlights++;
    if (!stats.engagedSections.includes(sectionId)) {
      stats.engagedSections.push(sectionId);
    }
  } else if (signal === "pause") {
    stats.totalPauses++;
    if (!stats.engagedSections.includes(sectionId)) {
      stats.engagedSections.push(sectionId);
    }
  } else if (signal === "skip") {
    stats.totalSkips++;
    if (!stats.skippedSections.includes(sectionId)) {
      stats.skippedSections.push(sectionId);
    }
  }
  await saveSessionStats(stats);

  /* Emit cognitive event to Layer 3 */
  emitCognitiveEvent({
    type: signal,
    contentChunkId: sectionId,
    sourceId: url,
    sourceType: "website",
    timestamp: Date.now(),
    durationMs: 0,
    profile: updatedProfile,
  });
}

/* ─── End session and emit SESSION_END to Layer 3 ─── */
export async function endSession(): Promise<FullCognitiveProfile | null> {
  const profile = await getProfile();
  if (!profile) return null;

  const stats = await getSessionStats();
  const rlAgent = await ensureAgent();

  /* Decay epsilon after session */
  rlAgent.decayEpsilon();

  /* Increment session count */
  profile.rlState.sessionCount += 1;

  /* Compute dominant signal */
  const dominantSignal = rlAgent.computeDominantSignal(stats);

  /* Build session end payload */
  const sessionEndPayload: SessionEndPayload = {
    sessionStats: {
      ...stats,
      dominantSignal,
    },
    updatedProfile: profile,
  };

  /* Save updated profile */
  await updateProfile(profile);

  /* Clear session stats for next session */
  await clearSessionStats();

  return profile;
}

/* ─── Reset everything (profile + q-table + stats) ─── */
export async function resetEverything(): Promise<void> {
  agent = null;
  await deleteProfile();
}

/* ─── Create profile from onboarding baseline ─── */
export async function createProfileFromOnboarding(
  baseline: BaselineProfile,
  condition?: CognitiveNeed,
): Promise<FullCognitiveProfile> {
  const profile = await createProfile(baseline, condition);

  /* Trigger session start */
  try {
    await browser.runtime.sendMessage({
      type: "SESSION_START",
      payload: {
        sourceType: "onboarding",
        url: "onboarding",
        timestamp: Date.now(),
      },
    });
  } catch {
    /* no listeners */
  }

  return profile;
}

/* ─── Setup all message listeners (called by background) ─── */
export function setupLayer2Listeners(): void {
  browser.runtime.onMessage.addListener(async (message: unknown) => {
    const msg = message as Record<string, unknown>;

    switch (msg.type) {
      case "BEHAVIOR_SIGNAL": {
        const signalMsg = msg as unknown as BehaviorSignalMessage;
        await handleBehaviorSignal(
          signalMsg.signal,
          signalMsg.context.url,
          signalMsg.context.sectionId,
        );
        return { received: true };
      }

      case "GET_PROFILE": {
        const profile = await getProfile();
        return { type: "PROFILE_DATA", profile };
      }

      case "ONBOARDING_COMPLETE": {
        /* Background can respond if needed */
        return { received: true };
      }

      case "SESSION_END": {
        /* Handle session end triggered externally (e.g., tab close) */
        await endSession();
        return { received: true };
      }

      case "CONTROLS_CHANGED": {
        /* User changed overrides in popup — re-apply and broadcast */
        const profile = await getProfile();
        if (!profile) return { received: true };
        const overrides = await loadOverrides();
        if (overrides.enabled) {
          profile.transformationParams = applyOverridesToParams(
            profile.transformationParams,
            overrides,
          );
          await browser.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile });
          await broadcastProfileUpdate(profile);
        }
        return { received: true };
      }

      case "RESET_PROFILE": {
        await resetEverything();
        return { received: true };
      }

      default:
        return undefined; /* Not our message */
    }
  });

  console.log("[MindEase Layer2] Message listeners registered.");
}
