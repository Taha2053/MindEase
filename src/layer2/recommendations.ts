import type { BaselineProfile } from "@/types";

export interface AdaptationRecommendation {
  choice: "structured" | "visual";
  label: string;
  reason: string;
}

/** Conservative initial policy; no diagnosis, passive-event rewards or exploration. */
export function rankAdaptations(baseline?: Partial<BaselineProfile>): AdaptationRecommendation[] {
  const structured: AdaptationRecommendation = {
    choice: "structured", label: "Structured reading",
    reason: baseline?.formatPreference === "text"
      ? "You selected text as your starting preference."
      : "Read the original material in sections with separate AI explanations.",
  };
  const visual: AdaptationRecommendation = {
    choice: "visual", label: "Reading with a visual explanation",
    reason: baseline?.formatPreference === "visual"
      ? "You selected visual explanations as your starting preference."
      : "Try a diagram alongside the source text. Diagram quality depends on the material.",
  };
  return baseline?.formatPreference === "visual" ? [visual, structured] : [structured, visual];
}
