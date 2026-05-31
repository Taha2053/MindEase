/* ============================================================
   layer1/visualOrchestrator.ts — Visual Generation Orchestrator
   Decides per concept: Napkin (diagram) vs Flux (illustration).
   Caches results in storage. Fires async after content transform.
   ============================================================ */

import { v4 as uuidv4 } from "uuid";
import browser from "webextension-polyfill";
import type { VisualEntry, VisualsCache, TransformationParams } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { generateNapkinVisuals, type NapkinStyle } from "./napkinClient";

/* ── Cache helpers ──────────────────────────────────────────────── */

async function loadVisualsCache(): Promise<VisualsCache> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.VISUALS_CACHE);
    return (result[STORAGE_KEYS.VISUALS_CACHE] as VisualsCache) ?? { entries: [], updatedAt: 0 };
  } catch {
    return { entries: [], updatedAt: 0 };
  }
}

async function saveVisualsCache(cache: VisualsCache): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.VISUALS_CACHE]: cache });
}

/**
 * Generate visuals for a set of concepts.
 * Called after content transformation when useVisualAnchors is true.
 *
 * Napkin: generates diagrams/infographics for ALL concepts
 * Flux: generates illustrative images (only if useFlux is true, controlled by profile)
 *
 * Returns VisualEntry[] ready to be sent to the content script.
 */
export async function generateVisualsForConcepts(
  concepts: string[],
  params: TransformationParams,
): Promise<VisualEntry[]> {
  if (concepts.length === 0) return [];
  if (!params.useVisualAnchors) return [];

  // Deduplicate and trim
  const uniqueConcepts = [...new Set(concepts.map((c) => c.trim()).filter(Boolean))];
  if (uniqueConcepts.length === 0) return [];

  const now = Date.now();
  const entries: VisualEntry[] = [];

  // 1. Napkin diagrams for all concepts
  const style = mapStyleToNapkin(params);
  const napkinResults = await generateNapkinVisuals(uniqueConcepts.slice(0, 5), style);

  for (const nr of napkinResults) {
    const ext = nr.format === "png" ? "png" : "svg";
    const filename = `MindEase/visuals/${sanitizeFilename(nr.concept)}.${ext}`;
    browser.downloads.download({
      url: nr.dataUrl,
      filename,
      saveAs: false,
    }).catch(() => {}); // silent if downloads fail (e.g. no permission)

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
 * Map cognitive profile to a Napkin visual style.
 */
function mapStyleToNapkin(params: TransformationParams): NapkinStyle {
  // Formal style for higher simplification (clean, structured)
  // Colorful for visual-heavy profiles
  if (params.simplificationLevel >= 2) return "formal";
  if (params.useVisualAnchors) return "colorful";
  return "casual";
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

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 100) || "visual";
}
