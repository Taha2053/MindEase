// ============================================================
// layer3/knowledgeArtifact.ts — Knowledge Artifact Assembler
// Owner: Eya
//
// Final step of the Layer 3 pipeline. Takes all processed data
// and assembles the personalized knowledge artifact the student
// walks away with at the end of every session.
// ============================================================

import type {
  SessionLog,
  ContentChunk,
  CognitiveProfile,
  KnowledgeArtifact,
} from "@/types";
import { analyzeGaps }         from "./gapAnalyzer";
import { detectConnections }   from "./connectionDetector";
import { generateStudyCards }  from "./studyCardGenerator";
import { saveArtifact }        from "./storage";

// ── Artifact Assembler ────────────────────────────────────────────────────────

/**
 * Run the full Layer 3 synthesis pipeline and produce the knowledge artifact.
 *
 * Pipeline:
 *   SessionLog + Chunks
 *      → Gap Analyzer        → gaps[]
 *      → Connection Detector → connections[]
 *      → Study Card Gen      → learnedCards[]
 *      → Artifact Assembler  → KnowledgeArtifact
 *
 * @param log      Completed session log from SessionTracker
 * @param chunks   Content chunks from Layer 1
 * @param profile  Learner's cognitive profile from Layer 2
 * @returns        The assembled and persisted knowledge artifact
 */
export async function assembleArtifact(
  log: SessionLog,
  chunks: ContentChunk[],
  profile: CognitiveProfile
): Promise<KnowledgeArtifact> {

  // ── Step 1: Identify gaps ─────────────────────────────────────────────────
  const gaps = analyzeGaps(log, chunks);

  // ── Step 2: Detect cross-source connections ───────────────────────────────
  const connections = detectConnections(log, chunks);

  // ── Step 3: Generate personalized study cards ─────────────────────────────
  const learnedCards = generateStudyCards(log, chunks, profile, gaps);

  // ── Step 4: Assemble the artifact ─────────────────────────────────────────
  const artifact: KnowledgeArtifact = {
    sessionId:    log.sessionId,
    userId:       log.userId,
    profile,
    learnedCards,
    gaps,
    connections,
    generatedAt:  Date.now(),
  };

  // ── Step 5: Persist to storage ────────────────────────────────────────────
  await saveArtifact(artifact);

  console.log(
    `[Layer 3] Artifact assembled — ` +
    `${learnedCards.length} cards | ` +
    `${gaps.length} gaps | ` +
    `${connections.length} connections`
  );

  return artifact;
}
