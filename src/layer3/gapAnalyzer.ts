// ============================================================
// layer3/gapAnalyzer.ts - Flagged Gaps List
// Owner: Eya
//
// Reads the completed session log and identifies content chunks
// the learner didn't absorb - classifying them by severity.
// ============================================================

import type { SessionLog, Gap, GapSeverity, ContentChunk } from "@/types";
import { GAP_THRESHOLD } from "./sessionTracker";

// ── Severity thresholds ───────────────────────────────────────────────────────
// Skipped  = score below 0.15 (user barely touched it)
// Skimmed  = score between 0.15 and GAP_THRESHOLD (user rushed through)
// Rushed   = score between GAP_THRESHOLD and 0.45 (partial engagement)

const SKIPPED_THRESHOLD  = 0.15;
const RUSHED_THRESHOLD   = 0.45;

function classifySeverity(score: number): GapSeverity | null {
  if (score < SKIPPED_THRESHOLD)  return "skipped";
  if (score < GAP_THRESHOLD)      return "skimmed";
  if (score < RUSHED_THRESHOLD)   return "rushed";
  return null; // score is acceptable - not a gap
}

// ── Gap Analyzer ─────────────────────────────────────────────────────────────

/**
 * Analyze a completed session log and return a list of flagged gaps.
 *
 * @param log     The completed session log from SessionTracker
 * @param chunks  The content chunks from Layer 1 (for concept labels + text)
 * @returns       Prioritized list of gaps (most severe first)
 */
export function analyzeGaps(log: SessionLog, chunks: ContentChunk[]): Gap[] {
  // Build a lookup map from chunkId → ContentChunk for O(1) access
  const chunkMap: Record<string, ContentChunk> = {};
  for (const chunk of chunks) {
    chunkMap[chunk.id] = chunk;
  }

  const gaps: Gap[] = [];

  for (const [chunkId, engagement] of Object.entries(log.engagementMap)) {
    const severity = classifySeverity(engagement.engagementScore);

    // Only flag as a gap if severity is not null (score was below acceptable)
    if (!severity) continue;

    const chunk = chunkMap[chunkId];

    // If Layer 1 hasn't provided the chunk yet, create a minimal gap entry
    const conceptLabel = chunk?.conceptTags?.[0] ?? `Chunk ${chunkId}`;
    const text         = chunk?.text ?? "(content not available)";

    gaps.push({
      chunkId,
      sourceId:     engagement.sourceId,
      conceptLabel,
      severity,
      text,
    });
  }

  // Sort: skipped first, then skimmed, then rushed
  const severityOrder: Record<GapSeverity, number> = {
    skipped: 0,
    skimmed: 1,
    rushed:  2,
  };

  return gaps.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
}
