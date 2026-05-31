/* ============================================================
   layer3/connectionDetector.ts — Cross-Source Learning Intelligence
   Owner: Eya

   Detects concepts encountered across multiple learning resources:
     - PDFs, videos, websites, documentation, AI conversations
   Uses lightweight extraction from available metadata + highlights,
   plus robust matching to find cross-source connections.
   ============================================================ */

import type {
  ContentChunk,
  SessionLog,
  HighlightNote,
  TabResource,
  Connection,
  CrossSourceConnection,
  CrossSourceResource,
  KeyConceptEntry,
} from "@/types";

/* ═══════════════════════════════════════════════════════════════════════════════
   1. STOP WORDS — common English words filtered out during extraction
   ═══════════════════════════════════════════════════════════════════════════════ */

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "this", "that", "these", "those", "it", "its", "they", "them", "their",
  "we", "our", "you", "your", "he", "she", "him", "her", "his", "my",
  "me", "i", "not", "no", "nor", "so", "if", "then", "than", "too",
  "very", "just", "about", "above", "after", "again", "all", "also",
  "any", "because", "before", "between", "both", "each", "few", "more",
  "most", "other", "some", "such", "only", "own", "same", "into", "over",
  "under", "up", "out", "off", "down", "here", "there", "when", "where",
  "why", "how", "what", "which", "who", "whom", "while", "during",
  "through", "within", "without", "along", "around", "about", "across",
  "among", "before", "behind", "below", "beneath", "beside", "between",
  "beyond", "inside", "outside", "upon", "via", "per",
  /* domain-specific noise */
  "page", "chapter", "section", "part", "introduction", "overview",
  "summary", "conclusion", "references", "appendix", "index", "content",
  "example", "definition", "note", "tip", "warning", "important",
  "please", "click", "read", "learn", "study", "review", "practice",
  "exercise", "problem", "solution", "answer", "question", "result",
  "using", "use", "used", "based", "following", "following", "shown",
  "called", "known", "defined", "described", "explained", "discussed",
  "including", "includes", "related", "various", "different", "common",
]);

/* ═══════════════════════════════════════════════════════════════════════════════
   2. TEXT NORMALISATION
   ═══════════════════════════════════════════════════════════════════════════════ */

/** Normalise a single word: lowercase, strip punctuation, strip common suffixes */
function normaliseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .replace(/['']s$/, "")         // possessives
    .replace(/s$/, s => s === "s" ? "" : s)  // basic plural → singular
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/ly$/, "")
    .replace(/tion$/, "t")
    .replace(/ment$/, "");
}

/** Split text into candidate concept words/phrases */
function tokenise(text: string): string[] {
  return text
    .split(/[\s,;:.!?()\[\]{}"'/\\|–—−-]+/)
    .map(w => normaliseWord(w))
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Extract meaningful n-gram phrases (bigrams + trigrams) */
function extractPhrases(words: string[], maxN: number = 3): string[] {
  const phrases: Set<string> = new Set();
  for (let n = 2; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(" ");
      if (phrase.length >= 5) phrases.add(phrase);
    }
  }
  return Array.from(phrases);
}

/** Compute word-overlap similarity between two strings */
function wordOverlap(a: string, b: string): number {
  const aWords = new Set(tokenise(a));
  const bWords = new Set(tokenise(b));
  if (aWords.size === 0 || bWords.size === 0) return 0;
  const intersection = new Set([...aWords].filter(w => bWords.has(w)));
  const union = new Set([...aWords, ...bWords]);
  return intersection.size / union.size;
}

/** Exact substring match (case-insensitive) */
function containsSimilar(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n) || n.includes(h);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   3. LIGHTWEIGHT CONCEPT EXTRACTION
   ═══════════════════════════════════════════════════════════════════════════════ */

export interface ExtractedConcept {
  label: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
  snippet: string;
}

/**
 * Extract concepts from a resource's available data.
 * Falls back gracefully when Layer 1 chunks are unavailable.
 */
function extractConceptsFromResource(
  tab: TabResource,
  chunksForSource: ContentChunk[],
  highlights: HighlightNote[],
): Map<string, ExtractedConcept> {
  const concepts = new Map<string, ExtractedConcept>();
  const sourceId = tab.url;
  const sourceTitle = tab.title || tab.url;
  const displayType = mapSourceType(tab.sourceType);

  function add(label: string, snippet: string, confidence: number): void {
    const key = label.toLowerCase();
    if (!concepts.has(key) || confidence > 0.5) {
      concepts.set(key, {
        label,
        sourceId,
        sourceTitle,
        sourceUrl: tab.url,
        sourceType: displayType,
        snippet,
      });
    }
  }

  // 1. Extract from Layer 1 concept tags (highest quality)
  for (const chunk of chunksForSource) {
    for (const tag of chunk.conceptTags) {
      add(tag, chunk.text.slice(0, 120), 1.0);
    }
    // Also extract phrases from chunk text
    const words = tokenise(chunk.text);
    const phrases = extractPhrases(words, 3);
    for (const phrase of phrases.slice(0, 5)) {
      add(phrase, chunk.text.slice(0, 120), 0.7);
    }
  }

  // 2. Extract from highlight notes
  const tabHighlights = highlights.filter(h => h.sourceUrl === tab.url);
  for (const note of tabHighlights) {
    const words = tokenise(note.text);
    const singleWords = words.filter(w => w.length >= 4);
    for (const w of singleWords) {
      add(w, note.text, 0.6);
    }
    const phrases = extractPhrases(words, 2);
    for (const p of phrases) {
      add(p, note.text, 0.8);
    }
  }

  // 3. Extract from resource title
  const titleWords = tokenise(tab.title);
  for (const w of titleWords) {
    add(w, tab.title, 0.5);
  }
  const titlePhrases = extractPhrases(titleWords, 3);
  for (const p of titlePhrases) {
    add(p, tab.title, 0.7);
  }

  // 4. Extract from URL path (fallback)
  if (concepts.size === 0) {
    const urlParts = tab.url.split(/[/?#]/).filter(Boolean);
    for (const part of urlParts) {
      const words = tokenise(decodeURIComponent(part.replace(/[-_+]/g, " ")));
      for (const w of words) {
        add(w, tab.url, 0.3);
      }
    }
  }

  return concepts;
}

/** Map internal source type to display-friendly label */
function mapSourceType(type: string): string {
  switch (type) {
    case "pdf":        return "PDF";
    case "video":      return "Video";
    case "website":    return "Website";
    case "lecture":    return "Documentation";
    default:           return type;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   4. RELIABLE MATCHING
   ═══════════════════════════════════════════════════════════════════════════════ */

interface ConceptEntry {
  label: string;
  resource: CrossSourceResource;
}

/**
 * Match concepts across resources using a combination of:
 * - Exact label match (case-insensitive)
 * - Word-overlap similarity
 * - Substring containment
 */
function matchAcrossResources(
  resourceConcepts: Map<string, ExtractedConcept>[],
): CrossSourceConnection[] {
  // Flatten all concepts into a list with resource info
  const allEntries: ConceptEntry[] = [];
  for (const concepts of resourceConcepts) {
    for (const [, extracted] of concepts) {
      allEntries.push({
        label: extracted.label,
        resource: {
          id: extracted.sourceId,
          title: extracted.sourceTitle,
          url: extracted.sourceUrl,
          type: extracted.sourceType,
          snippet: extracted.snippet,
        },
      });
    }
  }

  if (allEntries.length === 0) return [];

  // Group entries by normalised label
  const groups = new Map<string, { label: string; resources: Map<string, CrossSourceResource> }>();

  for (const entry of allEntries) {
    const normKey = entry.label.toLowerCase();

    if (!groups.has(normKey)) {
      groups.set(normKey, { label: entry.label, resources: new Map() });
    }
    const group = groups.get(normKey)!;

    // Store the richest snippet for each resource
    const existing = group.resources.get(entry.resource.id);
    if (!existing || entry.resource.snippet.length > existing.snippet.length) {
      group.resources.set(entry.resource.id, entry.resource);
    }
  }

  // Build connections for concepts appearing in 2+ resources
  const connections: CrossSourceConnection[] = [];
  const processed = new Set<string>();

  for (const [normKey, group] of groups) {
    if (processed.has(normKey)) continue;
    processed.add(normKey);

    const resources = Array.from(group.resources.values());
    const distinctSources = new Set(resources.map(r => r.id));

    // Only create connections for cross-source concepts
    if (distinctSources.size < 2) {
      // Try fuzzy match against other groups
      const candidates = Array.from(groups.entries())
        .filter(([k]) => !processed.has(k) && k !== normKey);

      for (const [candKey, candGroup] of candidates) {
        const wordScore = wordOverlap(group.label, candGroup.label);
        const contains = containsSimilar(group.label, candGroup.label);

        if (wordScore >= 0.33 || contains) {
          processed.add(candKey);
          const mergedResources = new Map(group.resources);
          for (const [id, r] of candGroup.resources) {
            if (!mergedResources.has(id)) {
              mergedResources.set(id, r);
            }
          }
          const merged = Array.from(mergedResources.values());
          const mergedSources = new Set(merged.map(r => r.id));
          if (mergedSources.size >= 2) {
            connections.push({
              conceptLabel: group.label.length >= candGroup.label.length
                ? group.label : candGroup.label,
              resources: merged,
              matchCount: mergedSources.size,
              matchType: "similar",
              confidence: wordScore,
            });
          }
        }
      }
      continue;
    }

    connections.push({
      conceptLabel: group.label,
      resources,
      matchCount: distinctSources.size,
      matchType: "exact",
      confidence: 1.0,
    });
  }

  // Sort by match count descending, then confidence
  return connections.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return b.confidence - a.confidence;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   5. LEGACY CONNECTION DETECTOR
   (preserved for backward compatibility with existing artifact)
   ═══════════════════════════════════════════════════════════════════════════════ */

function jaccardSimilarity(tagsA: string[], tagsB: string[]): number {
  if (tagsA.length === 0 && tagsB.length === 0) return 0;
  const setA = new Set(tagsA.map(t => t.toLowerCase()));
  const setB = new Set(tagsB.map(t => t.toLowerCase()));
  const intersection = new Set([...setA].filter(t => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

const SIMILARITY_THRESHOLD = 0.25;

/**
 * Detect conceptual connections across sources (legacy method).
 * Kept for backward compatibility with KnowledgeArtifact.
 */
export function detectConnections(
  log: SessionLog,
  chunks: ContentChunk[],
): Connection[] {
  const visitedChunks = chunks.filter(c => log.sources.includes(c.sourceId));
  const bySource: Record<string, ContentChunk[]> = {};
  for (const chunk of visitedChunks) {
    if (!bySource[chunk.sourceId]) bySource[chunk.sourceId] = [];
    bySource[chunk.sourceId].push(chunk);
  }

  const sourceIds = Object.keys(bySource);
  if (sourceIds.length < 2) return [];

  const connections: Connection[] = [];
  for (let i = 0; i < sourceIds.length; i++) {
    for (let j = i + 1; j < sourceIds.length; j++) {
      const sourceA = sourceIds[i];
      const sourceB = sourceIds[j];
      for (const chunkA of bySource[sourceA]) {
        for (const chunkB of bySource[sourceB]) {
          const score = jaccardSimilarity(chunkA.conceptTags, chunkB.conceptTags);
          if (score >= SIMILARITY_THRESHOLD) {
            const sharedTag =
              chunkA.conceptTags.find(t =>
                chunkB.conceptTags.map(x => x.toLowerCase()).includes(t.toLowerCase())
              ) ?? chunkA.conceptTags[0];
            connections.push({
              conceptLabel: sharedTag,
              chunkIds: [chunkA.id, chunkB.id],
              sourceIds: [sourceA, sourceB],
              similarityScore: score,
            });
          }
        }
      }
    }
  }
  return connections.sort((a, b) => b.similarityScore - a.similarityScore);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   6. PUBLIC API — Cross-Source Learning Intelligence
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Main entry point for cross-source learning intelligence.
 * Detects concepts appearing across multiple resources.
 *
 * @param tabs         All workspace tabs (resources)
 * @param chunks       Content chunks from Layer 1 (may be empty)
 * @param highlights   User highlight notes across all resources
 * @returns            Ranked cross-source connections
 */
export function detectCrossSourceConnections(
  tabs: TabResource[],
  chunks: ContentChunk[],
  highlights: HighlightNote[],
): CrossSourceConnection[] {
  if (tabs.length < 2) return [];

  // Group chunks by source URL
  const chunksBySource = new Map<string, ContentChunk[]>();
  for (const chunk of chunks) {
    if (!chunksBySource.has(chunk.sourceId)) {
      chunksBySource.set(chunk.sourceId, []);
    }
    chunksBySource.get(chunk.sourceId)!.push(chunk);
  }

  // Extract concepts for each tab
  const allExtracted: Map<string, ExtractedConcept>[] = [];
  for (const tab of tabs) {
    const tabChunks = chunksBySource.get(tab.url) ?? [];
    const tabConcepts = extractConceptsFromResource(tab, tabChunks, highlights);
    allExtracted.push(tabConcepts);
  }

  // Match across resources
  const connections = matchAcrossResources(allExtracted);

  return connections;
}

/**
 * Build a list of KeyConceptEntry from cross-source connections
 * for integration into the existing artifact structure.
 */
export function connectionsToKeyConcepts(
  connections: CrossSourceConnection[],
): KeyConceptEntry[] {
  return connections.map(c => ({
    label: c.conceptLabel,
    sources: c.resources.map(r => r.title || r.url),
    occurrences: c.resources.length,
    engagementScore: c.confidence,
  }));
}
