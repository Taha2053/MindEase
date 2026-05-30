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
  | "PROFILE_UPDATED"           // Layer 2 → Layer 1 + Layer 3
  | "BEHAVIOR_SIGNAL"            // content script → Layer 2
  | "GET_PROFILE"                // Layer 1 / Layer 3 → Layer 2
  | "PROFILE_DATA"               // Layer 2 → response
  | "ONBOARDING_COMPLETE"        // onboarding → background
  | "RESET_PROFILE"              // popup → background
  | "TRANSFORM_CONTENT"           // content → background (Layer 1)
  | "TRANSFORMED_CONTENT"         // background → content (response)
  | "TRANSFORM_ERROR"             // background → content (error)
  | "HIGHLIGHTS_DATA"             // background → popup/overlay (notes list)
  | "PING"                       // content → background (keepalive)
  | "HIGHLIGHT_NOTE"             // content → background (rich highlight)
  | "HIGHLIGHTS_GET"             // popup/overlay → background (fetch all notes)
  | "HIGHLIGHTS_UPDATED"         // background → popup/overlay (notes changed)
  | "ACTIVITY_PING";             // content → background (reset idle timer)

export interface ExtensionMessage {
  type:    MessageType;
  payload: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Study Workspace — Multi-Tab Session Types
// ═══════════════════════════════════════════════════════════════════════════════

export type SessionState = "active" | "passive" | "suspended" | "ended";

export interface HighlightNote {
  id: string;
  text: string;
  sourceUrl: string;
  resourceTitle: string;
  timestamp: number;
  sectionId?: string;
}

export interface NotesCollection {
  notes: HighlightNote[];
  updatedAt: number;
}

export interface TabResource {
  tabId: number;
  url: string;
  title: string;
  sourceType: "pdf" | "video" | "website" | "lecture";
  joinedAt: number;
  lastActiveAt: number;
  highlights: HighlightNote[];
}

export interface FocusSummary {
  totalTimeMs: number;
  focusedTimeMs: number;
  interruptionCount: number;
  longestDistractionMs: number;
  passiveTimeMs: number;
  suspendedTimeMs: number;
}

export interface WorkspaceSession {
  sessionId: string;
  userId: string;
  state: SessionState;
  tabs: TabResource[];
  startTime: number;
  endTime: number | null;
  lastActivityAt: number;
  enteredPassiveAt: number | null;
  enteredSuspendedAt: number | null;
  totalActiveDurationMs: number;
  totalPassiveDurationMs: number;
  totalSuspendedDurationMs: number;
  interruptionCount: number;
  longestDistractionMs: number;
  distractionStart: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 2 — Adaptive Cognitive Profiling — RL Agent Types
// ═══════════════════════════════════════════════════════════════════════════════

// ── Transformation Parameters (consumed by Layer 1) ───────────────────────────

export type ChunkSize           = "small" | "medium" | "large";
export type SimplificationLevel = 1 | 2 | 3;
export type CaptionSpeed        = "slow" | "normal" | "fast";
export type UseVisualAnchors    = boolean;
export type SummaryFrequency    = "high" | "medium" | "low";

export interface TransformationParams {
  chunkSize:           ChunkSize;
  simplificationLevel: SimplificationLevel;
  captionSpeed:        CaptionSpeed;
  useVisualAnchors:    UseVisualAnchors;
  summaryFrequency:    SummaryFrequency;
}

// ── RL State (tracked counters) ───────────────────────────────────────────────

export interface RLState {
  highlightRate:       number;
  pauseRate:           number;
  reReadRate:          number;
  skipRate:            number;
  sessionCount:        number;
  totalEngagementScore: number;
}

// ── Full Cognitive Profile (Layer 2's extended profile) ───────────────────────

export interface FullCognitiveProfile {
  userId:              string;
  learningStyle:       LearningStyle;
  attentionSpan:       AttentionSpan;
  anchorNeed:          boolean;
  condition:           CognitiveNeed;
  updatedAt:           number;                         // timestamp (ms)
  createdAt:           string;                         // ISO timestamp
  baseline:            BaselineProfile;
  rlState:             RLState;
  transformationParams: TransformationParams;
}

// ── Baseline Profile (onboarding output) ──────────────────────────────────────

export type FormatPreference   = "visual" | "text";
export type AttentionSpanType  = "short" | "medium" | "long";
export type ReadingPace        = "slow" | "moderate" | "fast";
export type InfoDensity        = "concise" | "detailed";
export type LearningApproach   = "example-first" | "theory-first";

export interface BaselineProfile {
  formatPreference:       FormatPreference;
  attentionSpan:          AttentionSpanType;
  readingPace:            ReadingPace;
  needsConceptAnchor:     boolean;
  secondLanguageLearner:  boolean;
  infoDensity:            InfoDensity;
  learningApproach:       LearningApproach;
}

// ── Behavior Signals ──────────────────────────────────────────────────────────

export type SignalType =
  | "highlight"
  | "pause"
  | "reRead"
  | "skip"
  | "tabSwitch";

export interface BehaviorSignalContext {
  url:        string;
  sectionId:  string;
}

export interface BehaviorSignalMessage {
  type:       "BEHAVIOR_SIGNAL";
  signal:     SignalType;
  timestamp:  string;
  context:    BehaviorSignalContext;
}

// ── Session End (consumed by Layer 3) ─────────────────────────────────────────

export type DominantSignal = "highlight" | "skip" | "pause";

export interface SessionStats {
  engagedSections:  string[];
  skippedSections:  string[];
  totalHighlights:  number;
  totalPauses:      number;
  totalSkips:       number;
  dominantSignal:   DominantSignal;
}

export interface SessionEndPayload {
  sessionStats:   SessionStats;
  updatedProfile: FullCognitiveProfile;
}

// ── Profile API ───────────────────────────────────────────────────────────────

export interface GetProfileRequest {
  type: "GET_PROFILE";
}

export interface ProfileDataResponse {
  type:    "PROFILE_DATA";
  profile: FullCognitiveProfile;
}

// ── Q-Learning Types ──────────────────────────────────────────────────────────

export interface QTable {
  [stateKey: string]: number[];   // stateKey → Q-values for each action (length = ACTION_COUNT)
}

export interface RLAgentConfig {
  learningRate:   number;
  discountFactor: number;
  epsilon:        number;
  epsilonDecay:   number;
  minEpsilon:     number;
}

export const ACTIONS = [
  "increaseChunkSize",
  "decreaseChunkSize",
  "increaseSimplification",
  "decreaseSimplification",
  "increaseCaptionSpeed",
  "decreaseCaptionSpeed",
  "toggleVisualAnchors",
  "increaseSummaryFrequency",
  "decreaseSummaryFrequency",
] as const;

export type Action = (typeof ACTIONS)[number];
export const ACTION_COUNT = ACTIONS.length;

// ── State Discretization ──────────────────────────────────────────────────────

export interface DiscreteState {
  highlightLevel: number;  // 0–2
  pauseLevel:     number;  // 0–2
  reReadLevel:    number;  // 0–2
  skipLevel:      number;  // 0–2
}

export function discretizeState(rlState: RLState): DiscreteState {
  const rateToLevel = (rate: number): number => {
    if (rate <= 0) return 0;
    if (rate <= 5) return 1;
    return 2;
  };
  return {
    highlightLevel: rateToLevel(rlState.highlightRate),
    pauseLevel:     rateToLevel(rlState.pauseRate),
    reReadLevel:    rateToLevel(rlState.reReadRate),
    skipLevel:      rateToLevel(rlState.skipRate),
  };
}

export function stateToKey(state: DiscreteState): string {
  return `${state.highlightLevel}-${state.pauseLevel}-${state.reReadLevel}-${state.skipLevel}`;
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  PROFILE:         "mindease_profile",
  QTABLE:          "mindease_qtable",
  ONBOARDING_DONE: "mindease_onboarding_done",
  SESSION_ACTIVE:  "mindease_session_active",
  SESSION_STATS:   "mindease_session_stats",
  WORKSPACE:       "mindease_workspace",
  NOTES:           "mindease_notes",
} as const;
