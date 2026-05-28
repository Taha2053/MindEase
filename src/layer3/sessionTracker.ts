// ============================================================
// layer3/sessionTracker.ts — Session Tracker
// Owner: Eya
//
// Receives CognitiveEvents from Layer 2 and builds a real-time
// engagement map: for each content chunk, how deeply did the
// learner actually engage with it?
// ============================================================

import { v4 as uuidv4 } from "uuid";
import type {
  CognitiveEvent,
  CognitiveProfile,
  SessionLog,
  ChunkEngagement,
  EngagementLevel,
} from "@/types";
import { saveActiveSession, loadActiveSession } from "./storage";

// ── Engagement scoring rules ──────────────────────────────────────────────────
// Each event type contributes a score delta to the chunk's engagement score.
// Scores are clamped to [0.0, 1.0].

const EVENT_SCORE_DELTA: Record<CognitiveEvent["type"], number> = {
  highlight:    +0.4,   // strong positive signal — user marked this important
  pause:        +0.25,  // user stopped to think
  "re-read":    +0.2,   // user came back — needed it again
  skip:         -0.4,   // user intentionally jumped over
  "fast-scroll": -0.2,  // user moved through without stopping
};

// Threshold below which a chunk is considered a gap
export const GAP_THRESHOLD = 0.3;

// ── Engagement level classifier ───────────────────────────────────────────────

function classifyEngagement(score: number): EngagementLevel {
  if (score >= 0.6) return "engaged";
  if (score >= GAP_THRESHOLD) return "skimmed";
  return "skipped";
}

// ── Session Tracker class ─────────────────────────────────────────────────────

export class SessionTracker {
  private log: SessionLog;

  constructor(userId: string, profile: CognitiveProfile) {
    this.log = {
      sessionId:     uuidv4(),
      userId,
      profile,
      sources:       [],
      engagementMap: {},
      startTime:     Date.now(),
      endTime:       null,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Process an incoming CognitiveEvent from Layer 2.
   * Updates the engagement score for the relevant content chunk.
   */
  recordEvent(event: CognitiveEvent): void {
    const { contentChunkId, sourceId } = event;

    // Register source if we haven't seen it yet
    if (!this.log.sources.includes(sourceId)) {
      this.log.sources.push(sourceId);
    }

    // Get or create engagement entry for this chunk
    if (!this.log.engagementMap[contentChunkId]) {
      this.log.engagementMap[contentChunkId] = {
        chunkId:         contentChunkId,
        sourceId,
        engagementScore: 0.5,   // start neutral — neither engaged nor skipped
        level:           "skimmed",
        events:          [],
        totalTimeMs:     0,
      };
    }

    const entry: ChunkEngagement = this.log.engagementMap[contentChunkId];

    // Apply score delta from event type
    const delta = EVENT_SCORE_DELTA[event.type];
    entry.engagementScore = Math.min(1.0, Math.max(0.0, entry.engagementScore + delta));

    // Update classification and accumulated time
    entry.level      = classifyEngagement(entry.engagementScore);
    entry.totalTimeMs += event.durationMs;
    entry.events.push(event);

    // Persist updated session to storage after every event
    saveActiveSession(this.log);
  }

  /**
   * Close the session and return the final log.
   * Call this when the student ends the session or closes the tab.
   */
  endSession(): SessionLog {
    this.log.endTime = Date.now();
    return this.log;
  }

  /** Get the current session log (read-only snapshot) */
  getLog(): Readonly<SessionLog> {
    return this.log;
  }

  /** Restore a session from storage (e.g. after browser restart) */
  static async restore(): Promise<SessionTracker | null> {
    const saved = await loadActiveSession();
    if (!saved) return null;

    // Re-hydrate a tracker from the saved log
    const tracker = Object.create(SessionTracker.prototype) as SessionTracker;
    tracker.log = saved;
    return tracker;
  }
}
