// ============================================================
// layer2/layer2.test.ts - Unit tests for Layer 2 RL agent & profiling
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RLAgent } from "./rlAgent";
import { discretizeState, stateToKey, ACTIONS } from "@/types";
import type { FullCognitiveProfile, BaselineProfile, UserOverrides } from "@/types";
import { applyOverridesToParams, isOverridden } from "./userControls";
import { generateExplanation } from "./explainer";

function makeFullProfile(overrides?: Partial<FullCognitiveProfile>): FullCognitiveProfile {
  const baseline: BaselineProfile = {
    formatPreference: "text",
    attentionSpan: "medium",
    readingPace: "moderate",
    needsConceptAnchor: false,
    secondLanguageLearner: false,
    infoDensity: "detailed",
    learningApproach: "theory-first",
  };

  return {
    userId: "test-user",
    learningStyle: "text",
    attentionSpan: "medium",
    anchorNeed: false,
    condition: "none",
    updatedAt: Date.now(),
    createdAt: new Date().toISOString(),
    baseline,
    rlState: {
      highlightRate: 0,
      pauseRate: 0,
      reReadRate: 0,
      skipRate: 0,
      sessionCount: 0,
      totalEngagementScore: 0,
    },
    transformationParams: {
      chunkSize: "medium",
      simplificationLevel: 2,
      captionSpeed: "normal",
      useVisualAnchors: false,
      summaryFrequency: "medium",
    },
    ...overrides,
  };
}

describe("Layer 2 - State Discretization", () => {
  it("discretizes rates into 3 levels (0, 1, 2)", () => {
    expect(discretizeState({
      highlightRate: 0,
      pauseRate: 3,
      reReadRate: 8,
      skipRate: 0,
      sessionCount: 1,
      totalEngagementScore: 0,
    })).toEqual({
      highlightLevel: 0,
      pauseLevel: 1,
      reReadLevel: 2,
      skipLevel: 0,
    });
  });

  it("converts discrete state to unique state key", () => {
    const state = { highlightLevel: 1, pauseLevel: 2, reReadLevel: 0, skipLevel: 1 };
    expect(stateToKey(state)).toBe("1-2-0-1");
  });
});

describe("Layer 2 - RL Agent Q-Learning", () => {
  let agent: RLAgent;

  beforeEach(() => {
    agent = new RLAgent({
      learningRate: 0.1,
      discountFactor: 0.9,
      epsilon: 0.0, // deterministic exploitation for testing
    });
  });

  it("updates Q-values and adapts profile on positive highlight signal", async () => {
    const profile = makeFullProfile();
    const result = await agent.processSignal(profile, "highlight");

    expect(result.reward).toBe(1.0);
    expect(result.updatedProfile.rlState.highlightRate).toBe(1);
    expect(ACTIONS).toContain(result.actionTaken);
  });

  it("penalizes on skip signal and tracks skipRate", async () => {
    const profile = makeFullProfile();
    const result = await agent.processSignal(profile, "skip");

    expect(result.reward).toBe(-1.0);
    expect(result.updatedProfile.rlState.skipRate).toBe(1);
  });
});

describe("Layer 2 - User Controls & Overrides", () => {
  it("applies user overrides on top of RL parameters when enabled", () => {
    const profile = makeFullProfile();
    const overrides: UserOverrides = {
      chunkSize: "small",
      simplificationLevel: 3,
      enabled: true,
      updatedAt: Date.now(),
    };

    const finalParams = applyOverridesToParams(profile.transformationParams, overrides);
    expect(finalParams.chunkSize).toBe("small");
    expect(finalParams.simplificationLevel).toBe(3);
    expect(finalParams.captionSpeed).toBe("normal"); // untouched
  });

  it("ignores user overrides when disabled", () => {
    const profile = makeFullProfile();
    const overrides: UserOverrides = {
      chunkSize: "small",
      enabled: false,
      updatedAt: Date.now(),
    };

    const finalParams = applyOverridesToParams(profile.transformationParams, overrides);
    expect(finalParams.chunkSize).toBe("medium");
  });

  it("detects whether a parameter is overridden", () => {
    const overrides: UserOverrides = {
      chunkSize: "small",
      enabled: true,
      updatedAt: Date.now(),
    };
    expect(isOverridden(overrides, "chunkSize")).toBe(true);
    expect(isOverridden(overrides, "captionSpeed")).toBe(false);
  });
});

describe("Layer 2 - Explainability", () => {
  it("generates clear human-readable explanations for adaptations", () => {
    const profile = makeFullProfile();
    const explanation = generateExplanation(
      "increaseChunkSize",
      profile.rlState,
      profile.baseline,
      profile.transformationParams,
    );

    expect(explanation.category).toBe("chunkSize");
    expect(explanation.title.length).toBeGreaterThan(0);
    expect(explanation.explanation.length).toBeGreaterThan(0);
  });
});
