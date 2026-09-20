import { v4 as uuidv4 } from "uuid";
import { annotateSourceBlocks } from "./llmClient";
import type { TransformationParams, BaselineProfile, ContentChunk } from "@/types";
import { createSourceBlocks, attachAnnotations } from "./sourceBlocks";

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
  if (pageText.length > 120_000 || blocks.some(block => block.text.length > 20_000)) {
    throw new Error("This material is too large for one adaptation. Select a shorter section; the original has not been changed.");
  }
  const chunks: ContentChunk[] = [];
  for (let i = 0; i < blocks.length; i += 6) {
    const batch = blocks.slice(i, i + 6);
    const response = await annotateSourceBlocks(batch, params);
    const transformed = attachAnnotations(batch, response, sourceId, pageType);
    chunks.push(...transformed);
    await onBatch?.(transformed, i > 0, i + 6 >= blocks.length);
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
