/* ============================================================
   layer1/visualOrchestrator.ts - Visual Generation Orchestrator
   Decides per concept: Napkin (diagram) vs Flux (illustration).
   Caches results in storage. Fires async after content transform.
   ============================================================ */

import { v4 as uuidv4 } from "uuid";
import browser from "webextension-polyfill";
import type { VisualEntry, VisualsCache, TransformationParams, ContentChunk } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { generateNapkinVisuals, generateNapkinVisualFromContent, type NapkinOptions } from "./napkinClient";
import { generateFluxImages, type FluxResult } from "./fluxClient";

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
 * Napkin: generates diagrams/infographics for ALL concepts
 * Flux: generates illustrative images (only if useFlux is true)
 *
 * Returns VisualEntry[] ready to be sent to the content script.
 */
export async function generateVisualsForConcepts(
  concepts: string[],
  params: TransformationParams,
  force = false,
  useFlux = false,
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

  // 2. Flux illustrative images (optional)
  if (useFlux) {
    try {
      const fluxResults = await generateFluxImages(uniqueConcepts.slice(0, 3));
      for (const [concept, result] of fluxResults) {
        entries.push({
          id: uuidv4(),
          concept,
          source: "flux",
          format: "png",
          dataUrl: result.dataUrl,
          width: result.width,
          height: result.height,
          generatedAt: now,
          expiresAt: now + 25 * 60 * 1000,
        });
      }
    } catch (err) {
      console.warn("[VisualOrchestrator] Flux generation failed:", err);
    }
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
  useFlux = false,
): Promise<VisualEntry[]> {
  if (chunks.length === 0) return [];
  if (!params.useVisualAnchors && !force) return [];

  const now = Date.now();
  const entries: VisualEntry[] = [];
  const napkinOptions = mapToNapkinOptions(params);

  const results = await Promise.allSettled(
    chunks.slice(0, 5).map(async (chunk) => {
      const label = chunk.summary
        ? chunk.summary.slice(0, 60)
        : chunk.conceptTags[0] ?? `Section ${chunk.position + 1}`;
      const content = chunk.text.slice(0, 2000);
      return generateNapkinVisualFromContent(content, label, napkinOptions);
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      entries.push({
        id: uuidv4(),
        concept: r.value.concept,
        source: "napkin",
        format: r.value.format,
        dataUrl: r.value.dataUrl,
        width: r.value.width,
        height: r.value.height,
        generatedAt: now,
        expiresAt: now + 25 * 60 * 1000,
      });
    } else {
      console.warn("[VisualOrchestrator] Skipped chunk visual:", r.reason?.message || r.reason);
    }
  }

  // Flux illustrative images for chunks (optional)
  if (useFlux) {
    const concepts = chunks.slice(0, 3).map(c => c.conceptTags[0] ?? `Section ${c.position + 1}`).filter(Boolean);
    try {
      const fluxResults = await generateFluxImages(concepts);
      for (const [concept, result] of fluxResults) {
        entries.push({
          id: uuidv4(),
          concept,
          source: "flux",
          format: "png",
          dataUrl: result.dataUrl,
          width: result.width,
          height: result.height,
          generatedAt: now,
          expiresAt: now + 25 * 60 * 1000,
        });
      }
    } catch (err) {
      console.warn("[VisualOrchestrator] Flux chunk generation failed:", err);
    }
  }

  const cache = await loadVisualsCache();
  cache.entries.push(...entries);
  cache.updatedAt = now;
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


