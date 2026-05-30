/* ============================================================
   layer1/index.ts — Real-Time Content Transformation
   Owner: Rayhane

   Transforms raw page text into structured ContentChunk[] using
   direct Gemini API calls. Handles websites, PDFs, and lectures.
   Each chunk is shaped by the user's cognitive profile.
   ============================================================ */

import { v4 as uuidv4 } from "uuid";
import { transformWebContent, transformPDF, transformLecture } from "./geminiClient";
import type { TransformationParams, ContentChunk } from "@/types";

/**
 * Transform raw page content into structured chunks adapted
 * to the given cognitive profile via Gemini API.
 *
 * @param pageText  Raw text extracted from the page
 * @param pageType  Type of content source
 * @param profile   Current transformation parameters from the cognitive profile
 * @returns         Array of content chunks ready for Layer 3 tracking
 */
export async function transformContent(
  pageText: string,
  pageType: "website" | "pdf" | "lecture",
  profile: TransformationParams,
): Promise<ContentChunk[]> {
  const sourceId = window?.location?.href ?? "unknown";
  const sourceType = pageType === "lecture" ? "lecture" : pageType === "pdf" ? "pdf" : "website";

  let transformed: string;

  switch (pageType) {
    case "pdf":
      transformed = await transformPDF(pageText, profile);
      break;
    case "lecture":
      transformed = await transformLecture(pageText, profile);
      break;
    case "website":
    default:
      transformed = await transformWebContent(pageText, profile);
      break;
  }

  /* Split Gemini response into ContentChunk[] */
  const chunks: ContentChunk[] = [];
  const lines = transformed.split("\n").filter((l) => l.trim().length > 0);

  let currentChunk = "";
  let chunkIndex = 0;

  for (const line of lines) {
    if (
      line.startsWith("[CHUNK") ||
      line.startsWith("[SUMMARY") ||
      line.startsWith("---") ||
      line.match(/^\*\*/)
    ) {
      if (currentChunk.trim().length > 0) {
        chunks.push({
          id: uuidv4(),
          sourceId,
          sourceType,
          text: currentChunk.trim(),
          conceptTags: extractConcepts(currentChunk),
          position: chunkIndex++,
        });
      }
      currentChunk = line + "\n";
    } else {
      currentChunk += line + "\n";
    }
  }

  /* Push remaining text */
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: uuidv4(),
      sourceId,
      sourceType,
      text: currentChunk.trim(),
      conceptTags: extractConcepts(currentChunk),
      position: chunkIndex,
    });
  }

  /* If no chunks were created (no delimiters), wrap entire response */
  if (chunks.length === 0 && transformed.trim().length > 0) {
    chunks.push({
      id: uuidv4(),
      sourceId,
      sourceType,
      text: transformed.trim(),
      conceptTags: [],
      position: 0,
    });
  }

  return chunks;
}

/**
 * Extract concept tags from text by looking for [CONCEPT: ...] markers.
 */
function extractConcepts(text: string): string[] {
  const tags: string[] = [];
  const regex = /\[CONCEPT:\s*([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tags.push(match[1].trim());
  }
  return tags;
}
