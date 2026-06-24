import { v4 as uuidv4 } from "uuid";
import { transformWebContent, transformPDF, transformLecture, transformVideoTranscript } from "./llmClient";
import type { TransformationParams, BaselineProfile, ContentChunk } from "@/types";

export interface TransformInput {
  transformationParams: TransformationParams;
  baseline: BaselineProfile;
}

export async function transformContent(
  pageText: string,
  pageType: "website" | "pdf" | "lecture",
  params: TransformInput,
  sourceUrl?: string,
): Promise<ContentChunk[]> {
  const sourceId = sourceUrl ?? "unknown";
  const sourceType = pageType === "lecture" ? "lecture" : pageType === "pdf" ? "pdf" : "website";

  let transformed: string;

  switch (pageType) {
    case "pdf":
      transformed = await transformPDF(pageText, params);
      break;
    case "lecture":
      transformed = await transformLecture(pageText, params);
      break;
    case "website":
    default:
      transformed = await transformWebContent(pageText, params);
      break;
  }

  return parseAnnotatedContent(transformed, sourceId, sourceType);
}

export async function transformVideoContent(
  transcript: string,
  params: TransformInput,
  sourceUrl?: string,
): Promise<ContentChunk[]> {
  const sourceId = sourceUrl ?? "unknown";
  const transformed = await transformVideoTranscript(transcript, params);
  return parseAnnotatedContent(transformed, sourceId, "video");
}

function parseAnnotatedContent(
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
  let currentIsExample = false;
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
      isExample: currentIsExample || undefined,
      hasDefinitions: hasDefs || undefined,
    });
    currentText = "";
    currentConcepts = [];
    currentSummary = "";
    currentIsExample = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[CHUNK/i.test(trimmed)) {
      flushChunk();
      continue;
    }

    if (/^\[CONCEPT:\s*([^\]]+)\]/i.test(trimmed)) {
      const match = trimmed.match(/\[CONCEPT:\s*([^\]]+)\]/i);
      if (match) currentConcepts.push(match[1].trim());
      currentText += line + "\n";
      continue;
    }

    if (/^\[SUMMARY:/i.test(trimmed)) {
      const match = trimmed.match(/\[SUMMARY:\s*([^\]]+)\]/i);
      if (match) currentSummary = match[1].trim();
      continue;
    }

    if (/^\[EXAMPLE\]|^\[EXAMPLE_END\]|^\[\/EXAMPLE\]/i.test(trimmed)) {
      if (/^\[EXAMPLE\]/i.test(trimmed)) currentIsExample = true;
      if (/^\[\/EXAMPLE\]|^\[EXAMPLE_END\]/i.test(trimmed)) currentIsExample = false;
      currentText += line + "\n";
      continue;
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
