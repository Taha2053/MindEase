// ============================================================
// layer3/knowledgeArtifact.ts - Knowledge Artifact Assembler
// Owner: Eya
//
// Final step of the Layer 3 pipeline. Takes all processed data
// and assembles the personalized 7-section study artifact the
// student walks away with at the end of every session.
// ============================================================

import type {
  SessionLog,
  ContentChunk,
  CognitiveProfile,
  KnowledgeArtifact,
  PersonalizedArtifact,
  ResourceEntry,
  KeyConceptEntry,
  FocusMetrics,
  HighlightNote,
  TabResource,
  FocusSummary,
  Gap,
  CrossSourceConnection,
} from "@/types";
import { analyzeGaps }         from "./gapAnalyzer";
import { detectConnections, detectCrossSourceConnections, connectionsToKeyConcepts } from "./connectionDetector";
import { generateStudyCards }  from "./studyCardGenerator";
import { saveArtifact }        from "./storage";

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeFocusMetrics(ws?: FocusSummary | null): FocusMetrics {
  if (!ws || ws.totalTimeMs <= 0) {
    return { totalDurationMs: 0, focusedTimeMs: 0, interruptionCount: 0, longestInterruptionMs: 0, focusScore: 0 };
  }
  const total = ws.totalTimeMs;
  const focused = Math.max(0, ws.focusedTimeMs);
  return {
    totalDurationMs: total,
    focusedTimeMs: focused,
    interruptionCount: ws.interruptionCount,
    longestInterruptionMs: ws.longestDistractionMs,
    focusScore: total > 0 ? Math.min(1, focused / total) : 0,
  };
}

function buildResourceEntries(tabs?: TabResource[] | null): ResourceEntry[] {
  if (!tabs || tabs.length === 0) return [];
  return tabs.map(t => ({
    url: t.url,
    title: t.title,
    sourceType: t.sourceType,
    timeSpentMs: t.lastActiveAt - t.joinedAt,
    notesCount: t.highlights.length,
    conceptsFound: [],
    joinedAt: t.joinedAt,
    lastActiveAt: t.lastActiveAt,
  }));
}

function extractKeyConcepts(
  log: SessionLog,
  chunks: ContentChunk[],
): KeyConceptEntry[] {
  const conceptMap = new Map<string, { sources: Set<string>; occurrences: number; totalEngagement: number }>();

  for (const chunk of chunks) {
    for (const tag of chunk.conceptTags) {
      const key = tag.toLowerCase();
      if (!conceptMap.has(key)) {
        conceptMap.set(key, { sources: new Set(), occurrences: 0, totalEngagement: 0 });
      }
      const entry = conceptMap.get(key)!;
      entry.sources.add(chunk.sourceId);
      entry.occurrences++;
      const engagement = log.engagementMap[chunk.id];
      entry.totalEngagement += engagement?.engagementScore ?? 0.5;
    }
  }

  return Array.from(conceptMap.entries())
    .map(([label, data]) => ({
      label,
      sources: Array.from(data.sources),
      occurrences: data.occurrences,
      engagementScore: data.occurrences > 0
        ? Math.min(1, data.totalEngagement / data.occurrences)
        : 0.5,
    }))
    .sort((a, b) => b.engagementScore - a.engagementScore);
}

function inferConceptsForTab(
  tab: TabResource,
  allKeyConcepts: KeyConceptEntry[],
): string[] {
  const tabConcepts = allKeyConcepts.filter(kc =>
    kc.sources.some(s => tab.url.includes(s) || s.includes(tab.url)),
  );
  if (tabConcepts.length > 0) {
    return tabConcepts.map(c => c.label);
  }
  return allKeyConcepts.slice(0, 2).map(c => c.label);
}

// ── Artifact Assembler ───────────────────────────────────────────────────────

/**
 * Run the full Layer 3 synthesis pipeline and produce the personalized artifact.
 *
 * @param log       Completed session log from SessionTracker
 * @param chunks    Content chunks from Layer 1
 * @param profile   Learner's cognitive profile from Layer 2
 * @param highlights Aggregated highlight notes (user notes)
 * @param tabs      Workspace tab resources (for resource sections)
 * @param focus     Workspace focus summary (for focus metrics)
 * @returns         The assembled and persisted personalized artifact
 */
export async function assembleArtifact(
  log: SessionLog,
  chunks: ContentChunk[],
  profile: CognitiveProfile,
  highlights?: HighlightNote[] | null,
  tabs?: TabResource[] | null,
  focus?: FocusSummary | null,
): Promise<KnowledgeArtifact & PersonalizedArtifact> {

  // ── Step 1: Identify gaps ─────────────────────────────────────────────────
  const gaps = analyzeGaps(log, chunks);

  // ── Step 2: Detect cross-source connections ───────────────────────────────
  const connections = detectConnections(log, chunks);

  // ── Step 4: Build 7-section artifact ──────────────────────────────────────
  const keyConcepts = extractKeyConcepts(log, chunks);

  // ── Step 2b: Cross-Source Learning Intelligence ───────────────────────────
  const crossSourceConnections = tabs
    ? detectCrossSourceConnections(tabs, chunks, highlights ?? [])
    : [];
  const crossSourceConcepts = connectionsToKeyConcepts(crossSourceConnections);
  // Merge cross-source concepts into key concepts (avoiding duplicates)
  const existingLabels = new Set(keyConcepts.map(kc => kc.label.toLowerCase()));
  for (const csc of crossSourceConcepts) {
    if (!existingLabels.has(csc.label.toLowerCase())) {
      keyConcepts.push(csc);
    }
  }

  // ── Step 3: Generate personalized study cards ─────────────────────────────
  const learnedCards = generateStudyCards(log, chunks, profile, gaps);

  const focusMetrics = computeFocusMetrics(focus);

  const resourcesUsed = buildResourceEntries(tabs);
  const resourceSummary = resourcesUsed.map(r => {
    const tabConcepts = keyConcepts.filter(kc =>
      kc.sources.some(s => r.url.includes(s) || s.includes(r.url)),
    );
    return {
      ...r,
      conceptsFound: tabConcepts.length > 0
        ? tabConcepts.map(c => c.label).slice(0, 5)
        : keyConcepts.slice(0, 2).map(c => c.label),
    };
  });

  const userNotes = highlights ?? [];

  const artifact: KnowledgeArtifact & PersonalizedArtifact = {
    // Legacy fields
    sessionId:    log.sessionId,
    userId:       log.userId,
    profile,
    learnedCards,
    gaps,
    connections,
    crossSourceConnections,
    generatedAt:  Date.now(),

    // 1. Resources Used
    resourcesUsed,

    // 2. Key Concepts
    keyConcepts,

    // 3. User Notes
    userNotes,

    // 4. Needs Review
    needsReview: gaps,

    // 5. Study Cards
    studyCards: learnedCards,

    // 6. Focus Summary
    focusSummary: focusMetrics,

    // 7. Resource Summary
    resourceSummary,
  };

  // ── Step 5: Persist to storage ────────────────────────────────────────────
  await saveArtifact(artifact);

  console.log(
    `[Layer 3] Artifact assembled - ` +
    `${learnedCards.length} cards | ` +
    `${gaps.length} gaps | ` +
    `${connections.length} connections | ` +
    `${userNotes.length} notes | ` +
    `focus ${(focusMetrics.focusScore * 100).toFixed(0)}%`,
  );

  return artifact;
}
