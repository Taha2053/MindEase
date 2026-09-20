const STRUCTURAL_TAGS = [
  /\[CHUNK(?:\s+\d+)?\]/gi,
  /\[CONCEPT:\s*[^\]]+\]/gi,
  /\[DEF:\s*[^\]]+\]/gi,
  /\[\/?EXAMPLE(?:_END)?\]/gi,
  /\[\/?FORMULA\]/gi,
];

export type IntegrityFailureReason =
  | "empty-source"
  | "empty-output"
  | "source-mismatch";

export interface IntegrityResult {
  valid: boolean;
  reason?: IntegrityFailureReason;
}

/**
 * Normalizes only whitespace introduced by structural tag placement. Words,
 * punctuation, citations, formula characters, and their order remain intact.
 */
export function canonicalizeSourceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Remove MindEase metadata while retaining the source text between tags. */
export function recoverSourceText(annotated: string): string {
  let recovered = annotated
    .replace(/```(?:html|text)?\s*/gi, "")
    .replace(/```/g, "")
    .replace(/\[SUMMARY:\s*[^\]]*\]/gi, "");

  for (const tag of STRUCTURAL_TAGS) {
    recovered = recovered.replace(tag, " ");
  }

  return canonicalizeSourceText(recovered);
}

export function validateSourceIntegrity(source: string, annotated: string): IntegrityResult {
  const canonicalSource = canonicalizeSourceText(source);
  if (!canonicalSource) return { valid: false, reason: "empty-source" };
  if (!annotated.trim()) return { valid: false, reason: "empty-output" };

  const recovered = recoverSourceText(annotated);
  if (recovered !== canonicalSource) {
    return { valid: false, reason: "source-mismatch" };
  }

  return { valid: true };
}

export class SourceIntegrityError extends Error {
  constructor(public readonly reason: IntegrityFailureReason) {
    super(`The adaptation was rejected because it did not preserve the source (${reason}).`);
    this.name = "SourceIntegrityError";
  }
}
