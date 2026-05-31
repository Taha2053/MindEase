// ============================================================
// layer3/index.ts — Layer 3 Entry Point
// Owner: Eya
//
// Wires together all Layer 3 modules and exposes the public API
// that the background service worker calls.
// ============================================================

import browser from "webextension-polyfill";
import type {
  CognitiveEvent, ContentChunk, CognitiveProfile,
  ExtensionMessage, FullCognitiveProfile,
  HighlightNote, TabResource, FocusSummary,
} from "@/types";
import { SessionTracker }  from "./sessionTracker";
import { assembleArtifact } from "./knowledgeArtifact";

// ── Active session tracker (singleton per session) ────────────────────────────
let tracker: SessionTracker | null = null;

// ── Session lifecycle ─────────────────────────────────────────────────────────

/**
 * Start a new tracking session.
 * Called by the background worker when a SESSION_START message arrives.
 */
export function startSession(userId: string, profile: CognitiveProfile): void {
  tracker = new SessionTracker(userId, profile);
  console.log("[Layer 3] Session started:", tracker.getLog().sessionId);
}

/**
 * End the current session and run the full synthesis pipeline.
 * Called by the background worker when SESSION_END message arrives.
 *
 * @param chunks      Content chunks from Layer 1 (optional)
 * @param highlights  Aggregated user highlight notes from workspace
 * @param tabs        Workspace tab resources for resource sections
 * @param focus       Workspace focus summary for focus metrics
 */
export async function endSession(
  chunks?: ContentChunk[],
  highlights?: HighlightNote[] | null,
  tabs?: TabResource[] | null,
  focus?: FocusSummary | null,
): Promise<void> {
  if (!tracker) {
    console.warn("[Layer 3] endSession called but no active session found.");
    return;
  }

  // Close the session log
  const log     = tracker.endSession();
  const profile = log.profile;

  // Run the full synthesis pipeline with workspace data
  const artifact = await assembleArtifact(
    log,
    chunks ?? [],
    profile,
    highlights,
    tabs,
    focus,
  );

  // Notify popup that the artifact is ready
  browser.runtime.sendMessage({
    type:    "ARTIFACT_READY",
    payload: artifact,
  } as ExtensionMessage);

  // Reset tracker
  tracker = null;
}

// ── Incoming event handler ────────────────────────────────────────────────────

/**
 * Record a cognitive event from Layer 2.
 * Called by the background worker when a COGNITIVE_EVENT message arrives.
 */
export function recordEvent(event: CognitiveEvent): void {
  if (!tracker) {
    console.warn("[Layer 3] Event received but no active session. Dropping event.");
    return;
  }
  tracker.recordEvent(event);
}
