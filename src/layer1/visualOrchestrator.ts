/* ============================================================
   layer1/visualOrchestrator.ts - Visual Generation Orchestrator
   Generates source-grounded Napkin diagrams for selected content.
   Caches results in storage. Fires async after content transform.
   ============================================================ */

import { v4 as uuidv4 } from "uuid";
import browser from "webextension-polyfill";
import type { VisualEntry, VisualsCache, TransformationParams, ContentChunk, SessionFolderSummary } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { generateNapkinVisualFromContent } from "./napkinClient";
import { recordSessionFolder } from "@/utils/sessionStorageManager";

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
    const key = entry.id;
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

async function saveVisuals(entries: VisualEntry[], ownerId: string | null): Promise<void> {
  await navigator.locks.request("mindease-visuals", async () => {
    const auth = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
    if (((auth[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined)?.user?.id ?? null) !== ownerId) return;
    const cache = await loadVisualsCache();
    await browser.storage.local.set({
      [STORAGE_KEYS.VISUALS_CACHE]: { entries: pruneVisualsCache([...entries, ...cache.entries]), updatedAt: Date.now() },
    });
    const sessionId = entries[0]?.sessionId;
    if (!sessionId) return;
    const stored = await browser.storage.local.get(STORAGE_KEYS.SESSION_FOLDERS);
    const folder = (stored[STORAGE_KEYS.SESSION_FOLDERS] as SessionFolderSummary[] | undefined)
      ?.find(item => item.sessionId === sessionId && (item.ownerAccountId ?? null) === ownerId);
    if (!folder) return;
    const merged = new Map(folder.visuals.map(item => [item.id, item]));
    for (const visual of entries) merged.set(visual.id, {
      id: visual.id, concept: visual.concept,
      filename: `visuals/${visual.id}.${visual.format}`, dataUrl: visual.dataUrl,
    });
    await recordSessionFolder({ ...folder, visuals: [...merged.values()], savedAt: Date.now() });
  });
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
  sessionId?: string,
): Promise<VisualEntry[]> {
  if (!chunks.length || (!params.useVisualAnchors && !force)) return [];
  const context = await browser.storage.local.get([STORAGE_KEYS.AUTH_SESSION, STORAGE_KEYS.WORKSPACE]);
  const ownerId = (context[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined)?.user?.id ?? null;
  const workspace = context[STORAGE_KEYS.WORKSPACE] as { state?: string; sessionId?: string } | undefined;
  const archiveId = sessionId ?? (workspace?.state !== "ended" ? workspace?.sessionId : undefined);
  const entries: VisualEntry[] = [];
  const errors: string[] = [];
  for (const chunk of chunks.slice(0, 5)) {
    try {
      const label = (chunk.conceptTags[0] || chunk.summary || `Section ${chunk.position + 1}`).slice(0, 200);
      const result = await generateNapkinVisualFromContent(chunk.sourceText || chunk.text, label,
        { learnerProfile: { ...params, ...learnerProfile, diagramPlan: chunk.visualPrompt } });
      const now = Date.now();
      entries.push({ id: uuidv4(), sessionId: archiveId, sourceBlockId: chunk.id, concept: result.concept, source: "napkin", format: result.format,
        dataUrl: result.dataUrl, width: result.width, height: result.height,
        generatedAt: now, expiresAt: now + 24 * 60 * 60 * 1000 });
      await saveVisuals([entries[entries.length - 1]], ownerId);
      if (onVisual) await onVisual([...entries]);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!entries.length && errors.length) throw new Error(errors[0]);
  return entries;
}


