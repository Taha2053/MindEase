import type { ContentChunk } from "@/types";

export interface SourceBlock { id: string; text: string; position: number }

// Code fences and every supported TeX delimiter are indivisible source spans.
const PROTECTED_SOURCE = /```[\s\S]*?```|`[^`\n]+`|\[FORMULA\][\s\S]*?\[\/FORMULA\]|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$/g;

const formulaBodies = (text: string): string[] => [...text.matchAll(
  /```[\s\S]*?```|`[^`\n]+`|\[FORMULA\]([\s\S]*?)\[\/FORMULA\]|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/g,
)].flatMap(match => match[0].startsWith("`") ? [] : [(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]).replace(/\s+/g, "")]);

// Stable identifier, not a security hash. Position disambiguates repeated text.
const fingerprint = (text: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};

export function createSourceBlocks(text: string, sourceId: string): SourceBlock[] {
  if (!text.trim()) throw new Error("No readable source material was found.");
  const spans = [...text.matchAll(PROTECTED_SOURCE)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  const boundaries = [...text.matchAll(/\n\s*\n/g)]
    .map(match => match.index! + match[0].length)
    .filter(end => !spans.some(span => span.start < end && end < span.end));
  boundaries.push(text.length);
  const pieces: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    while (boundary - start > 6000) {
      let end = start + 6000;
      const protectedSpan = spans.find(span => span.start < end && end < span.end);
      if (protectedSpan) end = protectedSpan.start > start ? protectedSpan.start : protectedSpan.end;
      else {
        const whitespace = text.lastIndexOf(" ", end);
        if (whitespace > start) end = whitespace + 1;
      }
      pieces.push(text.slice(start, end));
      start = end;
    }
    if (boundary > start) pieces.push(text.slice(start, boundary));
    start = boundary;
  }
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
    const sourceFormulas = formulaBodies(block.text);
    const generatedFormulas = formulaBodies(value.adaptedText);
    for (const formula of sourceFormulas) {
      const index = generatedFormulas.indexOf(formula);
      if (index < 0) throw new Error("Generated adaptation omitted or changed a source formula.");
      generatedFormulas.splice(index, 1);
    }
    const adaptedText = value.adaptedText.trim();
    return {
      id: block.id, sourceId, sourceType, position: block.position,
      text: adaptedText, sourceText: block.text,
      conceptTags: (value.concepts as string[]).slice(0, 12), isExample: value.isExample,
    };
  });
}
