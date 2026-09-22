/* ============================================================
   layer1/visualOrchestrator.ts - Visual Generation Orchestrator
   Generates source-grounded Napkin diagrams for selected content.
   Caches results in storage. Fires async after content transform.
   ============================================================ */

import { v4 as uuidv4 } from "uuid";
import browser from "webextension-polyfill";
import type { VisualEntry, VisualsCache, TransformationParams, ContentChunk } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { generateNapkinVisuals, generateNapkinVisualFromContent, type NapkinOptions } from "./napkinClient";

/* ── Cache helpers ──────────────────────────────────────────────── */

async function loadVisualsCache(): Promise<VisualsCache> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.VISUALS_CACHE);
    return (result[STORAGE_KEYS.VISUALS_CACHE] as VisualsCache) ?? { entries: [], updatedAt: 0 };
  } catch {
    return { entries: [], updatedAt: 0 };
  }
}

const MAX_CACHE_ENTRIES = 20;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

function pruneVisualsCache(entries: VisualEntry[]): VisualEntry[] {
  const unique = new Map<string, VisualEntry>();
  for (const entry of [...entries].sort((a, b) => b.generatedAt - a.generatedAt)) {
    const key = `${entry.source}:${entry.concept.trim().toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, entry);
  }

  const retained: VisualEntry[] = [];
  let bytes = 0;
  for (const entry of unique.values()) {
    const entryBytes = entry.dataUrl.length * 2;
    if (retained.length >= MAX_CACHE_ENTRIES || bytes + entryBytes > MAX_CACHE_BYTES) continue;
    retained.push(entry);
    bytes += entryBytes;
  }
  return retained;
}

async function saveVisualsCache(cache: VisualsCache): Promise<void> {
  cache.entries = pruneVisualsCache(cache.entries);
  await browser.storage.local.set({ [STORAGE_KEYS.VISUALS_CACHE]: cache });
}

/**
 * Generate visuals for a set of concepts.
 * Called after content transformation when useVisualAnchors is true.
 *
 * Returns VisualEntry[] ready to be sent to the content script.
 */
export async function generateVisualsForConcepts(
  concepts: string[],
  params: TransformationParams,
  force = false,
): Promise<VisualEntry[]> {
  if (concepts.length === 0) return [];
  if (!params.useVisualAnchors && !force) return [];

  // Deduplicate and trim
  const uniqueConcepts = [...new Set(concepts.map((c) => c.trim()).filter(Boolean))];
  if (uniqueConcepts.length === 0) return [];

  const now = Date.now();
  const entries: VisualEntry[] = [];

  // 1. Napkin diagrams for all concepts
  const napkinOptions = mapToNapkinOptions(params);
  const napkinResults = await generateNapkinVisuals(uniqueConcepts.slice(0, 5), napkinOptions);

  for (const nr of napkinResults) {
    entries.push({
      id: uuidv4(),
      concept: nr.concept,
      source: "napkin",
      format: nr.format,
      dataUrl: nr.dataUrl,
      width: nr.width,
      height: nr.height,
      generatedAt: now,
      expiresAt: now + 25 * 60 * 1000,
    });
  }

  // Cache results
  const cache = await loadVisualsCache();
  cache.entries.push(...entries);
  cache.updatedAt = now;
  await saveVisualsCache(cache);

  return entries;
}

/**
 * Generate one visual per content chunk using the chunk's actual text.
 * Falls back to concept name if chunk text is empty.
 */
export async function generateVisualsFromChunks(
  chunks: ContentChunk[],
  params: TransformationParams,
  force = false,
  onVisual?: (entries: VisualEntry[]) => Promise<void>,
  learnerProfile?: object,
): Promise<VisualEntry[]> {
  if (!chunks.length || (!params.useVisualAnchors && !force)) return [];
  const entries: VisualEntry[] = [];
  const errors: string[] = [];
  for (const chunk of chunks.slice(0, 5)) {
    try {
      const label = (chunk.conceptTags[0] || chunk.summary || `Section ${chunk.position + 1}`).slice(0, 200);
      const result = await generateNapkinVisualFromContent(chunk.sourceText || chunk.text, label,
        { learnerProfile: { ...params, ...learnerProfile, diagramPlan: chunk.visualPrompt } });
      const now = Date.now();
      entries.push({ id: uuidv4(), sourceBlockId: chunk.id, concept: result.concept, source: "napkin", format: result.format,
        dataUrl: result.dataUrl, width: result.width, height: result.height,
        generatedAt: now, expiresAt: now + 24 * 60 * 60 * 1000 });
      if (onVisual) await onVisual([...entries]);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!entries.length && errors.length) throw new Error(errors[0]);
  const cache = await loadVisualsCache();
  cache.entries.push(...entries);
  cache.updatedAt = Date.now();
  await saveVisualsCache(cache);
  return entries;
}

/**
 * Map cognitive profile to Napkin visual generation options.
 */
function mapToNapkinOptions(params: TransformationParams): NapkinOptions {
  const opts: NapkinOptions = {};

  // Style: formal for high simplification, colorful for visual-heavy
  if (params.simplificationLevel >= 2) {
    opts.style = "formal";
    opts.visualQuery = "flowchart";
    opts.orientation = "horizontal";
  } else if (params.useVisualAnchors) {
    opts.style = "colorful";
    opts.visualQuery = "mindmap";
    opts.orientation = "auto";
  } else {
    opts.style = "casual";
    opts.visualQuery = "timeline";
    opts.orientation = "vertical";
  }

  opts.sortStrategy = "relevance";

  return opts;
}

/**
 * Get cached visuals for specific concepts (avoid re-generation).
 */
export async function getCachedVisuals(concepts: string[]): Promise<VisualEntry[]> {
  const cache = await loadVisualsCache();
  const now = Date.now();

  return cache.entries.filter(
    (e) => concepts.includes(e.concept) && e.expiresAt > now,
  );
}

