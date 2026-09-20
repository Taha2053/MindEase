import type { ContentChunk } from "@/types";

export interface SourceBlock { id: string; text: string; position: number }

// Stable identifier, not a security hash. Position disambiguates repeated text.
const fingerprint = (text: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};

export function createSourceBlocks(text: string, sourceId: string): SourceBlock[] {
  if (!text.trim()) throw new Error("No readable source material was found.");
  // Keep separators in the original blocks so concatenation reproduces input.
  const paragraphs = text.match(/[\s\S]+?(?:\n\s*\n|$)/g) ?? [text];
  return paragraphs.map((text, position) => ({
    id: `source-${fingerprint(sourceId)}-${position}-${fingerprint(text)}`,
    text,
    position,
  }));
}

export function attachAnnotations(
  blocks: SourceBlock[], raw: string, sourceId: string, sourceType: ContentChunk["sourceType"],
): ContentChunk[] {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || !Array.isArray((data as { blocks?: unknown }).blocks)) {
    throw new Error("Invalid annotation response.");
  }
  const entries = (data as { blocks: unknown[] }).blocks;
  if (entries.length !== blocks.length) throw new Error("Annotation block count does not match the source.");
  return blocks.map((block, index) => {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") throw new Error("Invalid annotation block.");
    const value = entry as Record<string, unknown>;
    if (value.id !== block.id) throw new Error("Annotation block identity or order does not match the source.");
    if (Object.keys(value).some(key => !["id", "concepts", "summary", "isExample"].includes(key))) {
      throw new Error("Annotation response contains unsupported fields.");
    }
    if (!Array.isArray(value.concepts) || value.concepts.length > 12
      || !value.concepts.every(item => typeof item === "string" && item.length <= 160)
      || typeof value.summary !== "string" || value.summary.length > 1200
      || typeof value.isExample !== "boolean") throw new Error("Invalid annotation fields.");
    return {
      id: block.id, sourceId, sourceType, position: block.position,
      text: block.text, sourceText: block.text,
      conceptTags: value.concepts as string[], summary: value.summary || undefined,
      isExample: value.isExample,
    };
  });
}
