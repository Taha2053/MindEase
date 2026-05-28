// ============================================================
// layer3/studyCardGenerator.ts — Personalized Study Card Generator
// Owner: Eya
//
// Takes engaged content chunks and formats them into study cards
// shaped to the learner's cognitive profile. The FORMAT of the card
// is as important as the content — ADHD ≠ dyslexia ≠ visual learner.
// ============================================================

import { v4 as uuidv4 } from "uuid";
import type {
  ContentChunk,
  CognitiveProfile,
  StudyCard,
  CardFormat,
  SessionLog,
  Gap,
} from "@/types";

// ── Card format selection ─────────────────────────────────────────────────────
// Maps the cognitive profile to the optimal card format.

function selectCardFormat(profile: CognitiveProfile): CardFormat {
  // ADHD: short bursts, high visual anchoring — chunked list format
  if (profile.condition === "adhd") return "chunked-text";

  // Dyslexia: wider spacing, no dense blocks — spaced list format
  if (profile.condition === "dyslexia") return "spaced-list";

  // Visual learner: diagram-first, minimal prose — visual anchor format
  if (profile.learningStyle === "visual") return "visual";

  // Audio learner: voice-friendly note structure
  if (profile.learningStyle === "audio") return "audio-note";

  // Default: clean text
  return "chunked-text";
}

// ── Card content formatters ───────────────────────────────────────────────────
// Each formatter reshapes the raw chunk text to suit the card format.

function formatChunkedText(chunk: ContentChunk): string {
  // Break into short bullet points — max 15 words per bullet
  const sentences = chunk.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences
    .map(s => `• ${s.trim()}`)
    .join("\n");
}

function formatSpacedList(chunk: ContentChunk): string {
  // Same as chunked but with extra line breaks — easier for dyslexic readers
  const sentences = chunk.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences
    .map(s => `• ${s.trim()}`)
    .join("\n\n"); // double line break between each point
}

function formatVisual(chunk: ContentChunk): string {
  // For now, output the concept tags as a visual anchor + short summary
  const tags = chunk.conceptTags.join(" → ");
  const summary = chunk.text.slice(0, 120) + (chunk.text.length > 120 ? "…" : "");
  return `[${tags}]\n\n${summary}`;
}

function formatAudioNote(chunk: ContentChunk): string {
  // Short, conversational phrasing — suitable for TTS or voice reading
  return `Remember: ${chunk.text.slice(0, 200)}`;
}

function applyFormat(chunk: ContentChunk, format: CardFormat): string {
  switch (format) {
    case "chunked-text": return formatChunkedText(chunk);
    case "spaced-list":  return formatSpacedList(chunk);
    case "visual":       return formatVisual(chunk);
    case "audio-note":   return formatAudioNote(chunk);
    default:             return chunk.text;
  }
}

// ── Study Card Generator ──────────────────────────────────────────────────────

/**
 * Generate personalized study cards for engaged content.
 *
 * @param log      The completed session log
 * @param chunks   All content chunks from the session
 * @param profile  The learner's cognitive profile
 * @param gaps     The gap list — cards for gap chunks get reviewFlag = true
 * @returns        Array of study cards shaped to the cognitive profile
 */
export function generateStudyCards(
  log: SessionLog,
  chunks: ContentChunk[],
  profile: CognitiveProfile,
  gaps: Gap[]
): StudyCard[] {
  const format = selectCardFormat(profile);

  // IDs of chunks that are flagged as gaps
  const gapChunkIds = new Set(gaps.map(g => g.chunkId));

  // Only generate cards for chunks that were actually engaged with
  const engagedChunks = chunks.filter(chunk => {
    const engagement = log.engagementMap[chunk.id];
    return engagement && engagement.level === "engaged";
  });

  return engagedChunks.map(chunk => ({
    id:         uuidv4(),
    concept:    chunk.conceptTags[0] ?? "Concept",
    format,
    content:    applyFormat(chunk, format),
    sourceId:   chunk.sourceId,
    reviewFlag: gapChunkIds.has(chunk.id),
  }));
}
