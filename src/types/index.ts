// ============================================================
// types/index.ts — Shared interfaces for all 3 layers
// Every layer imports from here. If you change a type, tell
// the team — it affects all of us.
// ============================================================

// ── Cognitive Profile (produced by Layer 2, consumed by Layers 1 & 3) ────────

export type LearningStyle  = "visual" | "text" | "audio" | "mixed";
export type AttentionSpan  = "short" | "medium" | "long";
export type CognitiveNeed  = "dyslexia" | "adhd" | "multilingual" | "none";

export interface CognitiveProfile {
  userId:        string;
  learningStyle: LearningStyle;
  attentionSpan: AttentionSpan;
  anchorNeed:    boolean;          // needs visual/conceptual anchors to follow content
  condition:     CognitiveNeed;
  updatedAt:     number;           // timestamp of last RL update
}

// ── Cognitive Events (Layer 2 → Layer 3 message contract) ────────────────────

export type EventType =
  | "highlight"    // user selected text
  | "pause"        // stopped scrolling / video paused
  | "re-read"      // scrolled back up to same chunk
  | "skip"         // jumped over a section quickly
  | "fast-scroll"; // scrolled through without stopping

export interface CognitiveEvent {
  type:           EventType;
  contentChunkId: string;       // ID of the content piece this event belongs to
  sourceId:       string;       // which source: PDF id, URL, video id
  sourceType:     "pdf" | "website" | "video" | "lecture";
  timestamp:      number;
  durationMs:     number;       // how long the user spent on this chunk
  profile:        CognitiveProfile;
}

// ── Content Chunk (produced by Layer 1, tracked by Layer 3) ──────────────────

export interface ContentChunk {
  id:          string;
  sourceId:    string;
  sourceType:  "pdf" | "website" | "video" | "lecture";
  text:        string;          // the actual content text
  conceptTags: string[];        // key concepts extracted by Layer 1
  position:    number;          // order in the source (0-indexed)
}

// ── Layer 3 — Session Tracker types ──────────────────────────────────────────

export type EngagementLevel = "engaged" | "skimmed" | "skipped";

export interface ChunkEngagement {
  chunkId:        string;
  sourceId:       string;
  engagementScore: number;       // 0.0 (skipped) → 1.0 (fully engaged)
  level:          EngagementLevel;
  events:         CognitiveEvent[];
  totalTimeMs:    number;
}

export interface SessionLog {
  sessionId:     string;
  userId:        string;
  profile:       CognitiveProfile;
  sources:       string[];                       // list of sourceIds visited
  engagementMap: Record<string, ChunkEngagement>; // chunkId → engagement
  startTime:     number;
  endTime:       number | null;                  // null = session still active
}

// ── Layer 3 — Gap Analyzer types ─────────────────────────────────────────────

export type GapSeverity = "skipped" | "skimmed" | "rushed";

export interface Gap {
  chunkId:      string;
  sourceId:     string;
  conceptLabel: string;
  severity:     GapSeverity;
  text:         string;          // excerpt of the missed content
}

// ── Layer 3 — Connection Detector types ──────────────────────────────────────

export interface Connection {
  conceptLabel:  string;
  chunkIds:      string[];       // chunks from different sources sharing this concept
  sourceIds:     string[];       // sources where this concept appears
  similarityScore: number;       // 0.0 → 1.0
}

// ── Layer 3 — Study Card types ────────────────────────────────────────────────

export type CardFormat = "visual" | "chunked-text" | "spaced-list" | "audio-note";

export interface StudyCard {
  id:          string;
  concept:     string;
  format:      CardFormat;       // chosen based on cognitive profile
  content:     string;           // the card body
  sourceId:    string;           // where this concept came from
  reviewFlag:  boolean;          // true = flagged as gap → needs extra review
}

// ── Layer 3 — Knowledge Artifact (final output) ───────────────────────────────

export interface KnowledgeArtifact {
  sessionId:   string;
  userId:      string;
  profile:     CognitiveProfile;
  learnedCards: StudyCard[];     // concepts genuinely engaged with
  gaps:        Gap[];            // what the brain skipped / missed
  connections: Connection[];     // cross-source concept links
  generatedAt: number;
}

// ── Inter-layer messaging (chrome.runtime.sendMessage) ───────────────────────

export type MessageType =
  | "COGNITIVE_EVENT"            // Layer 2 → Layer 3
  | "SESSION_START"              // background → Layer 3
  | "SESSION_END"                // background → Layer 3
  | "ARTIFACT_READY"             // Layer 3 → popup panel
  | "PROFILE_UPDATED";           // Layer 2 → Layer 1 + Layer 3

export interface ExtensionMessage {
  type:    MessageType;
  payload: unknown;
}
