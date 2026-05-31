/* ============================================================
   layer2/explainer.ts — Adaptation Explainability Layer
   Owner: Taha

   Generates human-readable explanations for every content
   adaptation decision made by the RL agent. No technical
   jargon, no RL terminology — just clear user understanding.
   ============================================================ */

import type {
  Action,
  RLState,
  BaselineProfile,
  TransformationParams,
  ExplanationMap,
  AdaptationExplanation,
  ExplanationCategory,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import browser from "webextension-polyfill";

/* ═══════════════════════════════════════════════════════════════════════════════
   Category mapping — each action maps to one of the 5 categories
   ═══════════════════════════════════════════════════════════════════════════════ */

const ACTION_CATEGORY: Record<Action, ExplanationCategory> = {
  increaseChunkSize:           "chunkSize",
  decreaseChunkSize:           "chunkSize",
  increaseSimplification:      "simplification",
  decreaseSimplification:      "simplification",
  toggleVisualAnchors:         "visualMode",
  increaseCaptionSpeed:        "captionPacing",
  decreaseCaptionSpeed:        "captionPacing",
  increaseSummaryFrequency:    "readingDensity",
  decreaseSummaryFrequency:    "readingDensity",
};

const CATEGORY_TITLES: Record<ExplanationCategory, string> = {
  chunkSize:        "Content Chunk Size",
  simplification:   "Content Complexity",
  visualMode:       "Visual Learning Aids",
  captionPacing:    "Content Reading Pace",
  readingDensity:   "Summary Frequency",
};

const CATEGORY_ORDER: ExplanationCategory[] = [
  "chunkSize",
  "simplification",
  "visualMode",
  "captionPacing",
  "readingDensity",
];

/* ═══════════════════════════════════════════════════════════════════════════════
   Explanation generators — one per action type
   ═══════════════════════════════════════════════════════════════════════════════ */

function explainChunkSize(
  action: Action,
  rlState: RLState,
  baseline: BaselineProfile,
): { explanation: string; actionLabel: string; title: string } {
  const decreasing = action === "decreaseChunkSize";
  const prefix = decreasing ? "Smaller" : "Larger";
  const suffix = decreasing
    ? "broken into smaller, focused sections"
    : "offered in broader, connected sections";

  // Determine the prime reason from behavioral signals
  const reasons: string[] = [];

  if (decreasing) {
    if (rlState.reReadRate > 2) {
      reasons.push("frequent rereading suggests smaller sections improve comprehension");
    }
    if (baseline.attentionSpan === "short") {
      reasons.push("the content was tailored to match a naturally shorter attention span");
    }
    if (rlState.skipRate > 2) {
      reasons.push("narrower sections help maintain focus and reduce skipping");
    }
    if (reasons.length === 0) {
      reasons.push("content was condensed into more digestible pieces");
    }
  } else {
    if (rlState.reReadRate <= 1 && rlState.highlightRate > 2) {
      reasons.push("steady engagement and highlighting show readiness for extended sections");
    }
    if (baseline.attentionSpan === "long") {
      reasons.push("longer sections align with a sustained attention pattern");
    }
    if (rlState.skipRate <= 1) {
      reasons.push("smooth reading flow without skipping supports broader content segments");
    }
    if (reasons.length === 0) {
      reasons.push("fewer interruptions suggest the reader can handle extended passages");
    }
  }

  return {
    title: `${prefix} Content Chunks`,
    actionLabel: decreasing ? "Decreased chunk size" : "Increased chunk size",
    explanation: `${prefix} content chunks were used because ${reasons[0]}.`,
  };
}

function explainSimplification(
  action: Action,
  rlState: RLState,
  baseline: BaselineProfile,
): { explanation: string; actionLabel: string; title: string } {
  const simplifying = action === "increaseSimplification";
  const reasons: string[] = [];

  if (simplifying) {
    if (baseline.readingPace === "slow") {
      reasons.push("the material was adapted to match a comfortable reading flow");
    }
    if (baseline.secondLanguageLearner) {
      reasons.push("clearer language makes complex ideas more accessible");
    }
    if (rlState.skipRate > 2) {
      reasons.push("simpler explanations help reduce the urge to skip ahead");
    }
    if (rlState.reReadRate > 2) {
      reasons.push("frequent revisits suggest that clearer wording would help");
    }
    if (reasons.length === 0) {
      reasons.push("a gentler complexity level makes the material easier to work through");
    }
    return {
      title: "Simplified Content",
      actionLabel: "Increased simplification",
      explanation: `Content was simplified because ${reasons[0]}.`,
    };
  } else {
    if (baseline.readingPace === "fast") {
      reasons.push("the original depth suits a reader who moves quickly through material");
    }
    if (rlState.highlightRate > 3) {
      reasons.push("active highlighting shows readiness for detailed content");
    }
    if (rlState.pauseRate > 2) {
      reasons.push("frequent pauses suggest the reader engages thoughtfully with complexity");
    }
    if (reasons.length === 0) {
      reasons.push("strong overall engagement allows for richer, more detailed material");
    }
    return {
      title: "Richer Content Depth",
      actionLabel: "Decreased simplification",
      explanation: `The material kept its original complexity because ${reasons[0]}.`,
    };
  }
}

function explainVisualMode(
  visualModeActive: boolean,
  rlState: RLState,
  baseline: BaselineProfile,
): { explanation: string; actionLabel: string; title: string } {
  const activated = visualModeActive;
  const reasons: string[] = [];

  if (activated) {
    if (baseline.formatPreference === "visual") {
      reasons.push("visual aids align with a natural preference for image-based learning");
    }
    if (baseline.needsConceptAnchor) {
      reasons.push("concept anchors help connect abstract ideas to concrete visuals");
    }
    if (baseline.learningApproach === "example-first") {
      reasons.push("examples and visual markers make new concepts easier to grasp");
    }
    if (reasons.length === 0) {
      reasons.push("additional visual cues can make key ideas stand out and easier to remember");
    }
    return {
      title: "Visual Aids Added",
      actionLabel: "Activated visual mode",
      explanation: `Visual markers were introduced because ${reasons[0]}.`,
    };
  } else {
    if (baseline.formatPreference === "text") {
      reasons.push("a text-focused format suits the preferred reading style");
    }
    if (reasons.length === 0) {
      reasons.push("visual elements were reduced for a cleaner, more focused reading experience");
    }
    return {
      title: "Text-Focused Mode",
      actionLabel: "Deactivated visual mode",
      explanation: `Visual aids were reduced because ${reasons[0]}.`,
    };
  }
}

function explainCaptionPacing(
  action: Action,
  rlState: RLState,
  baseline: BaselineProfile,
): { explanation: string; actionLabel: string; title: string } {
  const slowing = action === "decreaseCaptionSpeed";
  const reasons: string[] = [];

  if (slowing) {
    if (baseline.readingPace === "slow") {
      reasons.push("the pace was matched to a comfortable reading speed");
    }
    if (rlState.reReadRate > 2) {
      reasons.push("frequent revisits suggest more time is needed with each passage");
    }
    if (rlState.pauseRate > 3) {
      reasons.push("frequent pausing signals a need for slower content delivery");
    }
    if (reasons.length === 0) {
      reasons.push("a gentler pace gives more time to absorb each idea");
    }
    return {
      title: "Slower Reading Pace",
      actionLabel: "Slowed content pace",
      explanation: `The reading pace was eased because ${reasons[0]}.`,
    };
  } else {
    if (baseline.readingPace === "fast") {
      reasons.push("the pace keeps up with a naturally quick reading flow");
    }
    if (rlState.highlightRate > 3 && rlState.pauseRate <= 2) {
      reasons.push("consistent highlighting without frequent pauses shows readiness for faster pacing");
    }
    if (rlState.skipRate <= 1) {
      reasons.push("smooth progress without skipping supports a quicker pace");
    }
    if (reasons.length === 0) {
      reasons.push("the reader processes content efficiently and can handle a faster pace");
    }
    return {
      title: "Faster Reading Pace",
      actionLabel: "Increased content pace",
      explanation: `The reading pace was increased because ${reasons[0]}.`,
    };
  }
}

function explainReadingDensity(
  action: Action,
  rlState: RLState,
  baseline: BaselineProfile,
): { explanation: string; actionLabel: string; title: string } {
  const moreFrequent = action === "increaseSummaryFrequency";
  const reasons: string[] = [];

  if (moreFrequent) {
    if (baseline.attentionSpan === "short") {
      reasons.push("regular checkpoints help keep key ideas fresh despite a shorter attention span");
    }
    if (rlState.skipRate > 2) {
      reasons.push("additional summaries help catch concepts that may have been glossed over");
    }
    if (rlState.reReadRate > 2) {
      reasons.push("frequent revisits show that reinforcement summaries would be helpful");
    }
    if (reasons.length === 0) {
      reasons.push("more frequent summaries reinforce understanding as new material is covered");
    }
    return {
      title: "More Frequent Summaries",
      actionLabel: "Increased summary frequency",
      explanation: `Summaries were added more often because ${reasons[0]}.`,
    };
  } else {
    if (baseline.attentionSpan === "long") {
      reasons.push("sustained focus allows for longer stretches between checkpoints");
    }
    if (rlState.highlightRate > 3 && rlState.skipRate <= 1) {
      reasons.push("consistent engagement without skipping reduces the need for frequent recaps");
    }
    if (reasons.length === 0) {
      reasons.push("the current engagement pattern supports less frequent interruptions for summaries");
    }
    return {
      title: "Fewer Interruptions",
      actionLabel: "Decreased summary frequency",
      explanation: `Summaries were spaced out because ${reasons[0]}.`,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Main API — generate and persist an explanation for a single adaptation
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Generate a human-readable explanation for an adaptation action.
 *
 * @param action      The RL action that was taken
 * @param rlState     Current RL signal counters
 * @param baseline    User's baseline profile
 * @returns           An AdaptationExplanation with title, explanation, and action label
 */
export function generateExplanation(
  action: Action,
  rlState: RLState,
  baseline: BaselineProfile,
  newParams?: TransformationParams,
): AdaptationExplanation {
  const category = ACTION_CATEGORY[action];
  let result: { explanation: string; actionLabel: string; title: string };

  switch (category) {
    case "chunkSize":
      result = explainChunkSize(action, rlState, baseline);
      break;
    case "simplification":
      result = explainSimplification(action, rlState, baseline);
      break;
    case "visualMode":
      // Direction determined from actual params (toggle action doesn't tell us direction)
      result = explainVisualMode(newParams?.useVisualAnchors ?? false, rlState, baseline);
      break;
    case "captionPacing":
      result = explainCaptionPacing(action, rlState, baseline);
      break;
    case "readingDensity":
      result = explainReadingDensity(action, rlState, baseline);
      break;
  }

  return {
    category,
    title: result.title,
    explanation: result.explanation,
    actionLabel: result.actionLabel,
    timestamp: Date.now(),
  };
}

/**
 * Load the current explanation map from storage.
 */
export async function loadExplanations(): Promise<ExplanationMap> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.EXPLANATIONS);
    return (result[STORAGE_KEYS.EXPLANATIONS] as ExplanationMap) ?? {
      chunkSize: null,
      simplification: null,
      visualMode: null,
      captionPacing: null,
      readingDensity: null,
    };
  } catch {
    return { chunkSize: null, simplification: null, visualMode: null, captionPacing: null, readingDensity: null };
  }
}

/**
 * Persist the current explanation map to storage.
 */
export async function saveExplanations(explanations: ExplanationMap): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.EXPLANATIONS]: explanations });
}

/**
 * Record a single adaptation explanation. Merges with existing stored explanations.
 */
export async function recordExplanation(explanation: AdaptationExplanation): Promise<void> {
  const existing = await loadExplanations();
  existing[explanation.category] = explanation;
  await saveExplanations(existing);
}

/**
 * Get all non-null explanations in display order.
 */
export async function getActiveExplanations(): Promise<AdaptationExplanation[]> {
  const map = await loadExplanations();
  return CATEGORY_ORDER
    .map(c => map[c])
    .filter((e): e is AdaptationExplanation => e !== null);
}
