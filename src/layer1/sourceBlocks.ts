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
  // A page can contain a very long table/preformatted section without blank
  // lines. Split it losslessly so no single provider request exceeds context.
  const pieces = paragraphs.flatMap(paragraph => {
    if (paragraph.length <= 6000) return [paragraph];
    const result: string[] = [];
    for (let offset = 0; offset < paragraph.length; offset += 6000) {
      result.push(paragraph.slice(offset, offset + 6000));
    }
    return result;
  });
  return pieces.map((text, position) => ({
    id: `source-${fingerprint(sourceId)}-${position}-${fingerprint(text)}`,
    text,
    position,
  }));
}
export function batchSourceBlocks(blocks: SourceBlock[], maxChars = 18_000, maxBlocks = 6): SourceBlock[][] {
  const batches: SourceBlock[][] = [];
  let current: SourceBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    if (current.length && (current.length >= maxBlocks || chars + block.text.length > maxChars)) {
      batches.push(current); current = []; chars = 0;
    }
    current.push(block); chars += block.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
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
  const byId = new Map(entries.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const id = (entry as Record<string, unknown>).id;
    return typeof id === "string" ? [[id, entry] as const] : [];
  }));
  if (byId.size !== blocks.length || !blocks.every(block => byId.has(block.id))) {
    throw new Error("Annotation block identity or uniqueness does not match the source.");
  }
  const orderedEntries = blocks.map(block => byId.get(block.id)!);
  return blocks.map((block, index) => {
    const entry = orderedEntries[index];
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

export function sourceOnlyChunks(
  blocks: SourceBlock[], sourceId: string, sourceType: ContentChunk["sourceType"],
): ContentChunk[] {
  return blocks.map(block => ({
    id: block.id,
    sourceId,
    sourceType,
    position: block.position,
    text: block.text,
    sourceText: block.text,
    conceptTags: [],
  }));
}

export function attachAdaptedContent(
  blocks: SourceBlock[], raw: string, sourceId: string, sourceType: ContentChunk["sourceType"],
): ContentChunk[] {
  const data: unknown = JSON.parse(raw);
  const entries = data && typeof data === "object" ? (data as { blocks?: unknown }).blocks : undefined;
  if (!Array.isArray(entries) || entries.length !== blocks.length) throw new Error("Generated block count does not match the source.");
  const byId = new Map(entries.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const id = (entry as Record<string, unknown>).id;
    return typeof id === "string" ? [[id, entry] as const] : [];
  }));
  if (byId.size !== blocks.length || !blocks.every(block => byId.has(block.id))) {
    throw new Error("Generated block identity does not match the source.");
  }
  return blocks.map(block => {
    const value = byId.get(block.id) as Record<string, unknown>;
    if (Object.keys(value).some(key => !["id", "adaptedText", "concepts", "isExample"].includes(key))
      || typeof value.adaptedText !== "string" || !value.adaptedText.trim()
      || !Array.isArray(value.concepts) || !value.concepts.every(item => typeof item === "string" && item.length <= 160)
      || typeof value.isExample !== "boolean") throw new Error("Invalid generated adaptation fields.");
    const sourceFormulas = [...block.text.matchAll(/\[FORMULA\]([\s\S]*?)\[\/FORMULA\]/gi)].map(match => match[1].trim());
    const generatedFormulas = [...value.adaptedText.matchAll(/\[FORMULA\]([\s\S]*?)\[\/FORMULA\]/gi)].map(match => match[1].trim());
    if (sourceFormulas.length > 0) {
      const hasAllFormulas = sourceFormulas.every(sf =>
        generatedFormulas.some(gf => gf === sf || gf.replace(/\s+/g, "") === sf.replace(/\s+/g, "") || gf.replace(/\\operatorname\s*/g, "\\operatorname").replace(/\s+/g, "") === sf.replace(/\\operatorname\s*/g, "\\operatorname").replace(/\s+/g, ""))
      );
      if (!hasAllFormulas) {
        throw new Error("Generated adaptation omitted or changed a source formula.");
      }
    }
    const adaptedText = value.adaptedText.trim();
    return {
      id: block.id, sourceId, sourceType, position: block.position,
      text: adaptedText, sourceText: block.text,
      conceptTags: (value.concepts as string[]).slice(0, 12), isExample: value.isExample,
    };
  });
}
