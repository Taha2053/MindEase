// ============================================================
// layer3/layer3.test.ts - Unit tests for all Layer 3 modules
//
// Uses Vitest with mocked browser storage so no real
// chrome.storage.local calls are made.
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionTracker } from "./sessionTracker";
import { analyzeGaps } from "./gapAnalyzer";
import { detectConnections } from "./connectionDetector";
import { generateStudyCards } from "./studyCardGenerator";
import type {
  CognitiveEvent,
  CognitiveProfile,
  SessionLog,
  ContentChunk,
  ChunkEngagement,
  Gap,
} from "@/types";

// ── Mocks ───────────────────────────────────────────────────────────────────────
// SessionTracker.saveActiveSession / loadActiveSession write to chrome.storage
// via ./storage.  We mock that module so no real browser API is ever touched.
//
// webextension-polyfill is replaced at the Vite alias level during tests
// (see vite.config.ts resolve.alias) - no additional mock needed here.

vi.mock("./storage");

// ── Test fixtures ───────────────────────────────────────────────────────────────

/** Minimal CognitiveProfile factory - override fields to test specific paths. */
function makeProfile(overrides?: Partial<CognitiveProfile>): CognitiveProfile {
  return {
    userId:        "test-user",
    learningStyle: "text",
    attentionSpan: "medium",
    anchorNeed:    false,
    condition:     "none",
    updatedAt:     0,
    ...overrides,
  };
}

/** Minimal CognitiveEvent factory. */
function makeEvent(overrides?: Partial<CognitiveEvent>): CognitiveEvent {
  const profile = makeProfile();
  return {
    type:           "highlight",
    contentChunkId: "chunk-1",
    sourceId:       "src-1",
    sourceType:     "website",
    timestamp:      1000,
    durationMs:     500,
    profile,
    ...overrides,
  };
}

// =============================================================================
// 1. SessionTracker
// =============================================================================

describe("SessionTracker", () => {
  let tracker: SessionTracker;
  const profile = makeProfile();

  beforeEach(() => {
    // Fresh tracker before each test - starts with a neutral engagement map
    tracker = new SessionTracker("user-1", profile);
  });

  // ── Test A ─────────────────────────────────────────────────────────────────
  // Verifies that positive events ("highlight", "pause") increase the chunk's
  // engagement score from the neutral starting point (0.5).
  it("recordEvent - increases engagement score for 'highlight' and 'pause'", () => {
    tracker.recordEvent(makeEvent({ type: "highlight", contentChunkId: "chunk-a" }));
    // neutral 0.5 + highlight +0.4 → 0.9
    expect(tracker.getLog().engagementMap["chunk-a"].engagementScore).toBe(0.9);

    tracker.recordEvent(makeEvent({ type: "pause", contentChunkId: "chunk-a" }));
    // 0.9 + 0.25 = 1.15 → clamped to 1.0
    expect(tracker.getLog().engagementMap["chunk-a"].engagementScore).toBe(1.0);
  });

  // ── Test B ─────────────────────────────────────────────────────────────────
  // Verifies that negative events ("skip", "fast-scroll") decrease the chunk's
  // engagement score below the neutral starting point.
  it("recordEvent - decreases engagement score for 'skip' and 'fast-scroll'", () => {
    tracker.recordEvent(makeEvent({ type: "skip", contentChunkId: "chunk-b" }));
    // neutral 0.5 + skip -0.4 → 0.1
    expect(tracker.getLog().engagementMap["chunk-b"].engagementScore).toBeCloseTo(0.1);

    tracker.recordEvent(makeEvent({ type: "fast-scroll", contentChunkId: "chunk-b" }));
    // 0.1 - 0.2 = -0.1 → clamped to 0.0
    expect(tracker.getLog().engagementMap["chunk-b"].engagementScore).toBe(0.0);
  });

  // ── Test C ─────────────────────────────────────────────────────────────────
  // Verifies that repeated positive events never push the score above 1.0 and
  // repeated negative events never push it below 0.0.
  it("recordEvent - score clamped between 0.0 and 1.0", () => {
    // Drive the score up repeatedly - must never exceed 1.0
    tracker.recordEvent(makeEvent({ type: "highlight", contentChunkId: "chunk-c" }));
    tracker.recordEvent(makeEvent({ type: "highlight", contentChunkId: "chunk-c" }));
    tracker.recordEvent(makeEvent({ type: "highlight", contentChunkId: "chunk-c" }));
    // 0.5 + 0.4 + 0.4 + 0.4 = 1.7 → clamped to 1.0
    expect(tracker.getLog().engagementMap["chunk-c"].engagementScore).toBe(1.0);

    // Separate tracker for the negative-side test
    const t2 = new SessionTracker("user-1", profile);
    t2.recordEvent(makeEvent({ type: "skip", contentChunkId: "chunk-d" }));
    t2.recordEvent(makeEvent({ type: "skip", contentChunkId: "chunk-d" }));
    // 0.5 - 0.4 - 0.4 = -0.3 → clamped to 0.0
    expect(t2.getLog().engagementMap["chunk-d"].engagementScore).toBe(0.0);
  });

  // ── Test D ─────────────────────────────────────────────────────────────────
  // Verifies that endSession() writes a timestamp to endTime and returns the
  // completed SessionLog with all fields intact.
  it("endSession - sets endTime and returns the completed log", () => {
    const log = tracker.endSession();

    // endTime should be a non-null number (the moment the method was called)
    expect(log.endTime).not.toBeNull();
    expect(typeof log.endTime).toBe("number");

    // The returned log should be the same object held internally
    expect(log.sessionId).toBe(tracker.getLog().sessionId);
  });

  // ── Test E ─────────────────────────────────────────────────────────────────
  // Verifies the classifyEngagement thresholds:
  //   score >= 0.6  → "engaged"
  //   0.3 <= score < 0.6 → "skimmed"
  //   score < 0.3   → "skipped"
  it("recordEvent - classifies score >= 0.6 as 'engaged'", () => {
    tracker.recordEvent(makeEvent({ type: "highlight", contentChunkId: "chunk-e1" }));
    // 0.5 + 0.4 = 0.9 → engaged
    expect(tracker.getLog().engagementMap["chunk-e1"].level).toBe("engaged");
  });

  it("recordEvent - classifies score 0.3–0.6 as 'skimmed'", () => {
    tracker.recordEvent(makeEvent({ type: "fast-scroll", contentChunkId: "chunk-e2" }));
    // 0.5 - 0.2 = 0.3 → skimmed
    expect(tracker.getLog().engagementMap["chunk-e2"].level).toBe("skimmed");
  });

  it("recordEvent - classifies score < 0.3 as 'skipped'", () => {
    tracker.recordEvent(makeEvent({ type: "skip", contentChunkId: "chunk-e3" }));
    // 0.5 - 0.4 = 0.1 → skipped
    expect(tracker.getLog().engagementMap["chunk-e3"].level).toBe("skipped");
  });
});

// =============================================================================
// 2. GapAnalyzer
// =============================================================================

describe("GapAnalyzer", () => {
  /**
   * Build a minimal SessionLog with engagement scores for the given chunk IDs.
   * Each entry is assigned an engagement level consistent with its score.
   */
  function makeLog(entries: Record<string, number>): SessionLog {
    const engagementMap: Record<string, ChunkEngagement> = {};
    for (const [chunkId, score] of Object.entries(entries)) {
      engagementMap[chunkId] = {
        chunkId,
        sourceId:       "src-1",
        engagementScore: score,
        level:          score >= 0.6 ? "engaged" : score >= 0.3 ? "skimmed" : "skipped",
        events:         [],
        totalTimeMs:    0,
      };
    }
    return {
      sessionId:     "test-session",
      userId:        "user-1",
      profile:       makeProfile(),
      sources:       ["src-1"],
      engagementMap,
      startTime:     0,
      endTime:       100,
    };
  }

  /** Minimal ContentChunk factory. */
  function makeChunk(id: string, conceptTag?: string): ContentChunk {
    return {
      id,
      sourceId:   "src-1",
      sourceType: "website",
      text:       `Content for ${id}`,
      conceptTags: conceptTag ? [conceptTag] : [],
      position:   0,
    };
  }

  // ── Test A ─────────────────────────────────────────────────────────────────
  // Severity threshold: engagementScore < 0.15 → "skipped"
  it("classifies score < 0.15 as 'skipped'", () => {
    const log   = makeLog({ "chunk-1": 0.1 });
    const chunks = [makeChunk("chunk-1", "math")];
    const gaps  = analyzeGaps(log, chunks);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("skipped");
  });

  // ── Test B ─────────────────────────────────────────────────────────────────
  // Severity threshold: 0.15 ≤ score < GAP_THRESHOLD (0.3) → "skimmed"
  it("classifies score 0.15–0.30 as 'skimmed'", () => {
    const log   = makeLog({ "chunk-2": 0.2 });
    const chunks = [makeChunk("chunk-2", "physics")];
    const gaps  = analyzeGaps(log, chunks);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("skimmed");
  });

  // ── Test C ─────────────────────────────────────────────────────────────────
  // Severity threshold: GAP_THRESHOLD (0.3) ≤ score < RUSHED_THRESHOLD (0.45)
  // → "rushed"
  it("classifies score 0.30–0.45 as 'rushed'", () => {
    const log   = makeLog({ "chunk-3": 0.4 });
    const chunks = [makeChunk("chunk-3", "chemistry")];
    const gaps  = analyzeGaps(log, chunks);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("rushed");
  });

  // ── Test D ─────────────────────────────────────────────────────────────────
  // Any chunk with score >= RUSHED_THRESHOLD (0.45) is NOT a gap - it should
  // be excluded from the gaps list entirely.
  it("excludes chunks with score >= 0.45 from the gaps list", () => {
    const log   = makeLog({ "chunk-4": 0.5 });
    const chunks = [makeChunk("chunk-4", "biology")];
    const gaps  = analyzeGaps(log, chunks);

    expect(gaps).toHaveLength(0);
  });

  // ── Test E ─────────────────────────────────────────────────────────────────
  // The gap list must be sorted by severity priority:
  //   skipped (most urgent) → skimmed → rushed (least urgent)
  it("sorts gaps: skipped first, then skimmed, then rushed", () => {
    const log = makeLog({
      "a-rushed":  0.4,
      "b-skipped": 0.1,
      "c-skimmed": 0.2,
    });
    const chunks = [
      makeChunk("a-rushed", "chem"),
      makeChunk("b-skipped", "phys"),
      makeChunk("c-skimmed", "bio"),
    ];
    const gaps = analyzeGaps(log, chunks);

    expect(gaps).toHaveLength(3);
    expect(gaps[0].severity).toBe("skipped");
    expect(gaps[1].severity).toBe("skimmed");
    expect(gaps[2].severity).toBe("rushed");
  });
});

// =============================================================================
// 3. ConnectionDetector
// =============================================================================

describe("ConnectionDetector", () => {
  /** Build a minimal SessionLog that lists the visited sources. */
  function makeLog(sources: string[]): SessionLog {
    return {
      sessionId:     "test-session",
      userId:        "user-1",
      profile:       makeProfile(),
      sources,
      engagementMap: {},
      startTime:     0,
      endTime:       100,
    };
  }

  /** Minimal ContentChunk factory with configurable tags and source. */
  function makeChunk(
    id: string,
    sourceId: string,
    tags: string[],
  ): ContentChunk {
    return {
      id,
      sourceId,
      sourceType: "website",
      text:       `Content for ${id}`,
      conceptTags: tags,
      position:   0,
    };
  }

  // ── Test A ─────────────────────────────────────────────────────────────────
  // When two chunks from different sources have identical concept tags, the
  // Jaccard similarity is 1.0 and exactly one Connection is produced.
  it("identical tags across sources → 1 connection with similarity 1.0", () => {
    const log    = makeLog(["src-a", "src-b"]);
    const chunks = [
      makeChunk("chunk-1", "src-a", ["math"]),
      makeChunk("chunk-2", "src-b", ["math"]),
    ];

    const connections = detectConnections(log, chunks);

    expect(connections).toHaveLength(1);
    expect(connections[0].similarityScore).toBe(1.0);
    expect(connections[0].sourceIds).toEqual(["src-a", "src-b"]);
  });

  // ── Test B ─────────────────────────────────────────────────────────────────
  // Chunks that belong to the same source should NOT produce cross-source
  // connections - connections are *between* different sources only.
  it("chunks from the same source → 0 connections", () => {
    const log    = makeLog(["src-a"]);
    const chunks = [
      makeChunk("chunk-1", "src-a", ["math"]),
      makeChunk("chunk-2", "src-a", ["math"]),
    ];

    const connections = detectConnections(log, chunks);

    expect(connections).toHaveLength(0);
  });

  // ── Test C ─────────────────────────────────────────────────────────────────
  // Chunks from different sources but with no overlapping concept tags have
  // Jaccard similarity 0, which is below the SIMILARITY_THRESHOLD (0.25).
  it("different sources with no overlapping tags → 0 connections", () => {
    const log    = makeLog(["src-a", "src-b"]);
    const chunks = [
      makeChunk("chunk-1", "src-a", ["math"]),
      makeChunk("chunk-2", "src-b", ["physics"]),
    ];
    // Jaccard(["math"], ["physics"]) = 0/2 = 0  <  0.25

    const connections = detectConnections(log, chunks);

    expect(connections).toHaveLength(0);
  });

  // ── Test D ─────────────────────────────────────────────────────────────────
  // With only one source in the session log, no cross-source comparison is
  // possible - the function should short-circuit and return an empty array.
  it("only 1 source visited → 0 connections", () => {
    const log    = makeLog(["src-a"]);
    const chunks = [
      makeChunk("chunk-1", "src-a", ["math", "physics"]),
    ];

    const connections = detectConnections(log, chunks);

    expect(connections).toHaveLength(0);
  });
});

// =============================================================================
// 4. StudyCardGenerator
// =============================================================================

describe("StudyCardGenerator", () => {
  /** Minimal ContentChunk factory. */
  function makeChunk(
    id: string,
    tags?: string[],
    text?: string,
  ): ContentChunk {
    return {
      id,
      sourceId:   "src-1",
      sourceType: "website",
      text:       text ?? `Content for ${id}. This is sample text.`,
      conceptTags: tags ?? [id],
      position:   0,
    };
  }

  /**
   * Build a minimal SessionLog where only the IDs listed in `engagedChunkIds`
   * have an "engaged" level entry - other chunks won't appear in the map and
   * therefore won't get a card.
   */
  function makeLog(engagedChunkIds: string[]): SessionLog {
    const engagementMap: Record<string, ChunkEngagement> = {};
    for (const id of engagedChunkIds) {
      engagementMap[id] = {
        chunkId:         id,
        sourceId:        "src-1",
        engagementScore: 0.8,
        level:           "engaged",
        events:          [],
        totalTimeMs:     1000,
      };
    }
    return {
      sessionId:     "test-session",
      userId:        "user-1",
      profile:       makeProfile(),
      sources:       ["src-1"],
      engagementMap,
      startTime:     0,
      endTime:       100,
    };
  }

  // ── Test A ─────────────────────────────────────────────────────────────────
  // CognitiveProfile.condition === "adhd" should yield "chunked-text" cards.
  it("condition 'adhd' → format 'chunked-text'", () => {
    const profile = makeProfile({ condition: "adhd" });
    const log     = makeLog(["chunk-1"]);
    const chunks  = [makeChunk("chunk-1", ["math"])];

    const cards = generateStudyCards(log, chunks, profile, []);

    expect(cards).toHaveLength(1);
    expect(cards[0].format).toBe("chunked-text");
  });

  // ── Test B ─────────────────────────────────────────────────────────────────
  // CognitiveProfile.condition === "dyslexia" should yield "spaced-list" cards.
  it("condition 'dyslexia' → format 'spaced-list'", () => {
    const profile = makeProfile({ condition: "dyslexia" });
    const log     = makeLog(["chunk-1"]);
    const chunks  = [makeChunk("chunk-1", ["math"])];

    const cards = generateStudyCards(log, chunks, profile, []);

    expect(cards).toHaveLength(1);
    expect(cards[0].format).toBe("spaced-list");
  });

  // ── Test C ─────────────────────────────────────────────────────────────────
  // CognitiveProfile.learningStyle === "visual" should yield "visual" cards.
  it("learningStyle 'visual' → format 'visual'", () => {
    const profile = makeProfile({ learningStyle: "visual" });
    const log     = makeLog(["chunk-1"]);
    const chunks  = [makeChunk("chunk-1", ["math"])];

    const cards = generateStudyCards(log, chunks, profile, []);

    expect(cards).toHaveLength(1);
    expect(cards[0].format).toBe("visual");
  });

  // ── Test D ─────────────────────────────────────────────────────────────────
  // Only chunks with level === "engaged" (score >= 0.6) should produce cards.
  // Chunks missing from the engagement map or with a lower level are skipped.
  it("only generates cards for chunks with level 'engaged'", () => {
    const profile = makeProfile();
    // Only chunk-1 appears in the engagement map as "engaged"
    const log    = makeLog(["chunk-1"]);
    // Both chunks exist in the full chunk list
    const chunks = [
      makeChunk("chunk-1", ["math"]),
      makeChunk("chunk-2", ["physics"]),
    ];

    const cards = generateStudyCards(log, chunks, profile, []);

    // chunk-2 has no engagement entry → no card for it
    expect(cards).toHaveLength(1);
    expect(cards[0].concept).toBe("math");
  });

  // ── Test E ─────────────────────────────────────────────────────────────────
  // When a chunk's ID appears in the gaps list, the generated card for that
  // chunk must have reviewFlag === true so the popup UI can highlight it.
  it("sets reviewFlag = true for chunks in the gaps list", () => {
    const profile = makeProfile();
    const log     = makeLog(["chunk-1", "chunk-2"]);
    const chunks  = [
      makeChunk("chunk-1", ["math"]),
      makeChunk("chunk-2", ["physics"]),
    ];
    // Only chunk-1 is flagged as a gap
    const gaps: Gap[] = [
      {
        chunkId:      "chunk-1",
        sourceId:     "src-1",
        conceptLabel: "math",
        severity:     "skipped",
        text:         "missed content",
      },
    ];

    const cards = generateStudyCards(log, chunks, profile, gaps);

    expect(cards).toHaveLength(2);

    const card1 = cards.find(c => c.concept === "math")!;
    const card2 = cards.find(c => c.concept === "physics")!;
    expect(card1.reviewFlag).toBe(true);
    expect(card2.reviewFlag).toBe(false);
  });
});
