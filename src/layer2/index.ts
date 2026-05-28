// ============================================================
// layer2/index.ts — Adaptive Cognitive Profiling
// Owner: Taha
//
// Responsibility:
//   - 5-minute onboarding assessment
//   - Build baseline cognitive profile
//   - RL agent that reads behavioral signals
//   - Update profile after every session
//   - Send CognitiveEvents to Layer 3
//
// TODO (Taha):
//   - Onboarding assessment UI
//   - Baseline profile builder
//   - RL agent implementation
//   - Profile persistence + update mechanism
//   - Emit CognitiveEvent messages to background
// ============================================================

import browser from "webextension-polyfill";
import type { CognitiveEvent, CognitiveProfile } from "@/types";

/**
 * Emit a cognitive event to the background service worker.
 * Layer 3 sessionTracker receives this via the message router.
 *
 * @param event  The behavioral signal captured from the learner
 */
export function emitCognitiveEvent(event: CognitiveEvent): void {
  browser.runtime.sendMessage({
    type: "COGNITIVE_EVENT",
    payload: event,
  });
}

/**
 * Retrieve the current cognitive profile from storage.
 * Returns null if no profile has been established yet (pre-onboarding).
 */
export async function getCurrentProfile(): Promise<CognitiveProfile | null> {
  // TODO: implement profile retrieval from chrome.storage
  const result = await browser.storage.local.get("cognitiveProfile");
  return (result.cognitiveProfile as CognitiveProfile) ?? null;
}
