// ============================================================
// layer3/connectionDetector.ts — Cross-Source Connection Detector
// Owner: Eya
//
// When a student studies across multiple sources in one session
// (PDF + website + video), this finds concept overlaps between
// them and builds a unified connection map.
//
// Strategy: compare conceptTags from Layer 1 chunks across sources.
// For prototype phase, we use tag overlap (Jaccard similarity).
// Production upgrade: replace with embedding-based cosine similarity.
// ============================================================

import type { ContentChunk, Connection, SessionLog } from "@/types";

// ── Similarity functions ──────────────────────────────────────────────────────

/**
 * Jaccard similarity between two sets of concept tags.
 * Returns a value in [0.0, 1.0].
 * 1.0 = identical tag sets, 0.0 = no overlap.
 */
function jaccardSimilarity(tagsA: string[], tagsB: string[]): number {
  if (tagsA.length === 0 && tagsB.length === 0) return 0;

  const setA = new Set(tagsA.map(t => t.toLowerCase()));
  const setB = new Set(tagsB.map(t => t.toLowerCase()));

  const intersection = new Set([...setA].filter(t => setB.has(t)));
  const union        = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

// ── Connection Detector ───────────────────────────────────────────────────────

// Minimum similarity to consider two chunks as connected
const SIMILARITY_THRESHOLD = 0.25;

/**
 * Detect conceptual connections across sources in a session.
 *
 * @param log     The session log (to know which sources were visited)
 * @param chunks  All content chunks from all sources in the session
 * @returns       Array of detected cross-source connections
 */
export function detectConnections(
  log: SessionLog,
  chunks: ContentChunk[]
): Connection[] {
  // Only look at chunks from sources the student actually visited
  const visitedChunks = chunks.filter(c => log.sources.includes(c.sourceId));

  // Group chunks by source
  const bySource: Record<string, ContentChunk[]> = {};
  for (const chunk of visitedChunks) {
    if (!bySource[chunk.sourceId]) bySource[chunk.sourceId] = [];
    bySource[chunk.sourceId].push(chunk);
  }

  const sourceIds = Object.keys(bySource);

  // If only one source, no cross-source connections possible
  if (sourceIds.length < 2) return [];

  const connections: Connection[] = [];

  // Compare every chunk from source A against every chunk from source B
  for (let i = 0; i < sourceIds.length; i++) {
    for (let j = i + 1; j < sourceIds.length; j++) {
      const sourceA = sourceIds[i];
      const sourceB = sourceIds[j];

      for (const chunkA of bySource[sourceA]) {
        for (const chunkB of bySource[sourceB]) {
          const score = jaccardSimilarity(chunkA.conceptTags, chunkB.conceptTags);

          if (score >= SIMILARITY_THRESHOLD) {
            // Find the shared concept label (first overlapping tag)
            const sharedTag =
              chunkA.conceptTags.find(t =>
                chunkB.conceptTags
                  .map(x => x.toLowerCase())
                  .includes(t.toLowerCase())
              ) ?? chunkA.conceptTags[0];

            connections.push({
              conceptLabel:    sharedTag,
              chunkIds:        [chunkA.id, chunkB.id],
              sourceIds:       [sourceA, sourceB],
              similarityScore: score,
            });
          }
        }
      }
    }
  }

  // Sort by strongest connections first
  return connections.sort((a, b) => b.similarityScore - a.similarityScore);
}
