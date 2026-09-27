export interface TransformRequest {
  text: string;
  pageType: "website" | "pdf" | "video" | "lecture";
  adaptation: "structured" | "visual";
}

/** Validate the boundary before session mutation, storage, or provider calls. */
export function isTransformRequest(value: unknown): value is TransformRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.text === "string"
    && input.text.trim().length > 0
    && ["website", "pdf", "video", "lecture"].includes(String(input.pageType))
    && ["structured", "visual"].includes(String(input.adaptation))
    && typeof input.pageType === "string"
    && typeof input.adaptation === "string";
}
