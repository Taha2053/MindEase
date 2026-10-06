import { generateAdaptedBlocks } from "./llmClient";
import type { TransformationParams, BaselineProfile, ContentChunk } from "@/types";
import { createSourceBlocks, attachAdaptedContent, batchSourceBlocks, sourceOnlyChunks } from "./sourceBlocks";
import { createAdaptationPlan } from "./premiumClient";

export interface TransformInput {
  transformationParams: TransformationParams;
  baseline: BaselineProfile;
  outputLanguage?: "preferred" | "source";
}

export async function transformContent(
  pageText: string,
  pageType: "website" | "pdf" | "video" | "lecture",
  params: TransformInput,
  sourceUrl?: string,
  onBatch?: (chunks: ContentChunk[], append: boolean, done: boolean) => Promise<void> | void,
): Promise<ContentChunk[]> {
  const sourceId = sourceUrl ?? "unknown";
  const blocks = createSourceBlocks(pageText, sourceId);
  // Generation must have enough response budget to rewrite every supplied
  // Adaptive batching: group coherent paragraphs (up to 12,000 chars, max 6 blocks)
  // so the model sees more context at once and processes the entire article much faster.
  const batches = batchSourceBlocks(blocks, 12_000, 6);
  const chunks: ContentChunk[] = [];
  const plan = await createAdaptationPlan({
      title: typeof document === "undefined" ? sourceId : document.title,
      sourceType: pageType,
      sourceBlocks: blocks,
      learnerProfile: params,
    });
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let transformed: ContentChunk[];
    try {
      const response = await generateAdaptedBlocks(batch, params, plan);
      transformed = attachAdaptedContent(batch, response, sourceId, pageType);
    } catch (firstError) {
      try {
        const corrected = await generateAdaptedBlocks(batch, params, plan, true);
        transformed = attachAdaptedContent(batch, corrected, sourceId, pageType);
      } catch (retryError) {
        console.warn("[MindEase] Adapted generation rejected twice; rendering verified source blocks.", firstError, retryError);
        transformed = sourceOnlyChunks(batch, sourceId, pageType);
      }
    }
    const sections = Array.isArray(plan.sections) ? plan.sections as Array<{ id?: string; visual_prompt?: string }> : [];
    for (const chunk of transformed) {
      const section = sections.find(item => item.id === chunk.id);
      if (typeof section?.visual_prompt === "string" && section.visual_prompt.trim()) chunk.visualPrompt = section.visual_prompt;
    }
    chunks.push(...transformed);
    await onBatch?.(transformed, i > 0, i === batches.length - 1);
  }
  return chunks;
}

