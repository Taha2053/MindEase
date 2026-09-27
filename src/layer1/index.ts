import { v4 as uuidv4 } from "uuid";
import { generateAdaptedBlocks } from "./llmClient";
import type { TransformationParams, BaselineProfile, ContentChunk } from "@/types";
import { createSourceBlocks, attachAdaptedContent, batchSourceBlocks, sourceOnlyChunks } from "./sourceBlocks";
import { createAdaptationPlan } from "./premiumClient";

export interface TransformInput {
  transformationParams: TransformationParams;
  baseline: BaselineProfile;
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

export async function transformVideoContent(
  transcript: string,
  params: TransformInput,
  sourceUrl?: string,
): Promise<ContentChunk[]> {
  return transformContent(transcript, "video", params, sourceUrl);
}

export function parseAnnotatedContent(
  raw: string,
  sourceId: string,
  sourceType: "pdf" | "website" | "video" | "lecture",
): ContentChunk[] {
  const cleaned = raw
    .replace(/```html\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const chunks: ContentChunk[] = [];
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);

  let currentText = "";
  let currentConcepts: string[] = [];
  let currentSummary = "";
  let insideExample = false;
  let chunkContainsExample = false;
  let chunkIndex = 0;

  function flushChunk() {
    const text = currentText.trim();
    if (!text) return;
    const hasDefs = /\[DEF:/i.test(text);
    chunks.push({
      id: uuidv4(),
      sourceId,
      sourceType,
      text,
      conceptTags: [...new Set(currentConcepts)],
      position: chunkIndex++,
      summary: currentSummary || undefined,
      isExample: chunkContainsExample || undefined,
      hasDefinitions: hasDefs || undefined,
    });
    currentText = "";
    currentConcepts = [];
    currentSummary = "";
    insideExample = false;
    chunkContainsExample = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[CHUNK/i.test(trimmed)) {
      flushChunk();
      const rest = trimmed.replace(/^\[CHUNK[^\]]*\]\s*/i, "").trim();
      if (!rest) continue;
      // Process rest of the line
      for (const m of rest.matchAll(/\[CONCEPT:\s*([^\]]+)\]/gi)) {
        if (m[1]?.trim()) currentConcepts.push(m[1].trim());
      }
      if (/\[EXAMPLE\]/i.test(rest)) {
        insideExample = true;
        chunkContainsExample = true;
      }
      if (/\[\/EXAMPLE\]|\[EXAMPLE_END\]/i.test(rest)) insideExample = false;
      currentText += rest + "\n";
      continue;
    }

    for (const m of trimmed.matchAll(/\[CONCEPT:\s*([^\]]+)\]/gi)) {
      if (m[1]?.trim()) currentConcepts.push(m[1].trim());
    }

    if (/^\[SUMMARY:/i.test(trimmed)) {
      const match = trimmed.match(/\[SUMMARY:\s*([^\]]+)\]/i);
      if (match) currentSummary = match[1].trim();
      continue;
    }

    if (/\[EXAMPLE\]/i.test(trimmed)) {
      insideExample = true;
      chunkContainsExample = true;
    }
    if (/\[\/EXAMPLE\]|\[EXAMPLE_END\]/i.test(trimmed)) {
      insideExample = false;
    }

    currentText += line + "\n";
  }

  flushChunk();

  if (chunks.length === 0 && raw.trim().length > 0) {
    const hasDefs = /\[DEF:/i.test(raw);
    chunks.push({
      id: uuidv4(),
      sourceId,
      sourceType,
      text: raw.trim(),
      conceptTags: [],
      position: 0,
      hasDefinitions: hasDefs || undefined,
    });
  }

  return chunks;
}
