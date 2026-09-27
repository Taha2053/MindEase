/* ─── MindEase - Layer 2: RL Agent ───
     Lightweight Q-learning agent that adapts the cognitive
     profile's transformation parameters based on behavioral signals.
     Uses real Q-table, epsilon-greedy action selection, and
     state discretization from rlState counters.
  ───────────────────────────────────────────────────────────── */

import type {
  FullCognitiveProfile,
  TransformationParams,
  QTable,
  DiscreteState,
  Action,
  RLAgentConfig,
  SignalType,
  BaselineProfile,
} from "@/types";
import {
  ACTION_COUNT,
  ACTIONS,
  discretizeState,
  stateToKey,
} from "@/types";
import { getQTable, saveQTable, updateProfile, broadcastProfileUpdate } from "./profileManager";

/* ─── Default Agent Config ─── */
const DEFAULT_CONFIG: RLAgentConfig = {
  learningRate:   0.1,
  discountFactor: 0.9,
  epsilon:        0.3,
  epsilonDecay:   0.99,
  minEpsilon:     0.01,
};

/* ─── Signal Rewards ─── */
const SIGNAL_REWARDS: Record<SignalType, number> = {
  highlight:  +1.0,
  pause:      +0.5,
  reRead:      0.0,
  skip:       -1.0,
  tabSwitch:  -0.5,
};

/* ─── RL Agent Class ─── */
export class RLAgent {
  private config: RLAgentConfig;
  private qTable: QTable = {};
  private prevStateKey: string | null = null;
  private prevAction: Action | null = null;

  constructor(config: Partial<RLAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /* ─── Initialize / Load ─── */
  async load(): Promise<void> {
    this.qTable = await getQTable();
  }

  /* ─── Get current epsilon (decays over sessions) ─── */
  get epsilon(): number {
    return this.config.epsilon;
  }

  /* ─── Process a behavior signal → update profile → return reward and action ───
       RL flow:
         1. Signal arrives → reward from signal
         2. Update rlState counters (state transitions)
         3. Compute next state key
         4. Q-update: Q(prevState, prevAction) += lr * (reward + gamma * maxQ(nextState) - Q(prevState, prevAction))
         5. Select new action via epsilon-greedy from next state
         6. Apply action to transformation params
         7. Store (stateKey, action) for next iteration
  */
  async processSignal(
    profile: FullCognitiveProfile,
    signal: SignalType,
  ): Promise<{ reward: number; updatedProfile: FullCognitiveProfile; actionTaken: Action }> {
    const { rlState } = profile;

    /* 1. Update rlState counters - this changes the state */
    switch (signal) {
      case "highlight":
        rlState.highlightRate += 1;
        break;
      case "pause":
        rlState.pauseRate += 1;
        break;
      case "reRead":
        rlState.reReadRate += 1;
        break;
      case "skip":
        rlState.skipRate += 1;
        break;
      case "tabSwitch":
        rlState.skipRate += 0.5;
        break;
    }

    /* 2. Compute reward */
    const reward = SIGNAL_REWARDS[signal];
    rlState.totalEngagementScore += reward;

    /* 3. Compute next state key (state AFTER this signal) */
    const nextState = discretizeState(rlState);
    const nextKey = stateToKey(nextState);

    /* Ensure Q-table entry exists for next state */
    if (!this.qTable[nextKey]) {
      this.qTable[nextKey] = new Array(ACTION_COUNT).fill(0);
    }

    /* 4. Q-learning update: Q(s, a) += lr * (r + gamma * maxQ(s') - Q(s, a))
          Only update if we have a previous state/action to learn from. */
    if (this.prevStateKey !== null && this.prevAction !== null) {
      if (!this.qTable[this.prevStateKey]) {
        this.qTable[this.prevStateKey] = new Array(ACTION_COUNT).fill(0);
      }
      const prevQ = this.qTable[this.prevStateKey];
      const actionIdx = ACTIONS.indexOf(this.prevAction);
      const maxNextQ = Math.max(...this.qTable[nextKey]);
      const tdTarget = reward + this.config.discountFactor * maxNextQ;
      prevQ[actionIdx] = prevQ[actionIdx] + this.config.learningRate * (tdTarget - prevQ[actionIdx]);
      await saveQTable(this.qTable);
    }

    /* 5. Select new action from next state */
    const action = this.selectAction(rlState);

    /* 6. Apply action to transformation params
          If action would toggle visuals OFF but baseline needs visuals, prevent it. */
    if (action === "toggleVisualAnchors") {
      const wantsVisuals = profile.baseline.formatPreference === "visual"
        || profile.baseline.needsConceptAnchor === true;
      if (wantsVisuals && profile.transformationParams.useVisualAnchors) {
        const otherActions = ACTIONS.filter(a => a !== "toggleVisualAnchors");
        const fallback = otherActions[Math.floor(Math.random() * otherActions.length)];
        profile.transformationParams = this.applyAction(profile.transformationParams, fallback);
      } else {
        profile.transformationParams = this.applyAction(profile.transformationParams, action);
      }
    } else {
      profile.transformationParams = this.applyAction(profile.transformationParams, action);
    }

    /* 7. Store current state/action for next iteration */
    this.prevStateKey = nextKey;
    this.prevAction = action;

    /* 8. Save profile */
    profile.updatedAt = Date.now();
    await updateProfile(profile);
    await broadcastProfileUpdate(profile);

    return { reward, updatedProfile: profile, actionTaken: action };
  }

  /* ─── Epsilon-Greedy Action Selection ─── */
  selectAction(rlState: FullCognitiveProfile["rlState"]): Action {
    const state = discretizeState(rlState);
    const key = stateToKey(state);

    if (!this.qTable[key]) {
      this.qTable[key] = new Array(ACTION_COUNT).fill(0);
    }

    const qValues = this.qTable[key];

    /* Explore: random action */
    if (Math.random() < this.config.epsilon) {
      const idx = Math.floor(Math.random() * ACTION_COUNT);
      return ACTIONS[idx] as Action;
    }

    /* Exploit: best action (break ties randomly) */
    const maxQ = Math.max(...qValues);
    const bestIndices = qValues
      .map((q, i) => ({ q, i }))
      .filter((x) => x.q === maxQ)
      .map((x) => x.i);
    const chosenIdx = bestIndices[Math.floor(Math.random() * bestIndices.length)];
    return ACTIONS[chosenIdx] as Action;
  }

  /* ─── Apply Action to Transformation Params ─── */
  applyAction(params: TransformationParams, action: Action): TransformationParams {
    const p = { ...params };
    const chunkSizes: TransformationParams["chunkSize"][] = ["small", "medium", "large"];
    const simplLevels: TransformationParams["simplificationLevel"][] = [1, 2, 3];
    const captionSpeeds: TransformationParams["captionSpeed"][] = ["slow", "normal", "fast"];
    const sumFreqs: TransformationParams["summaryFrequency"][] = ["low", "medium", "high"];

    switch (action) {
      case "increaseChunkSize": {
        const idx = Math.min(chunkSizes.length - 1, chunkSizes.indexOf(p.chunkSize) + 1);
        p.chunkSize = chunkSizes[idx];
        break;
      }
      case "decreaseChunkSize": {
        const idx = Math.max(0, chunkSizes.indexOf(p.chunkSize) - 1);
        p.chunkSize = chunkSizes[idx];
        break;
      }
      case "increaseSimplification": {
        const idx = Math.min(simplLevels.length - 1, simplLevels.indexOf(p.simplificationLevel) + 1);
        p.simplificationLevel = simplLevels[idx];
        break;
      }
      case "decreaseSimplification": {
        const idx = Math.max(0, simplLevels.indexOf(p.simplificationLevel) - 1);
        p.simplificationLevel = simplLevels[idx];
        break;
      }
      case "increaseCaptionSpeed": {
        const idx = Math.min(captionSpeeds.length - 1, captionSpeeds.indexOf(p.captionSpeed) + 1);
        p.captionSpeed = captionSpeeds[idx];
        break;
      }
      case "decreaseCaptionSpeed": {
        const idx = Math.max(0, captionSpeeds.indexOf(p.captionSpeed) - 1);
        p.captionSpeed = captionSpeeds[idx];
        break;
      }
      case "toggleVisualAnchors": {
        p.useVisualAnchors = !p.useVisualAnchors;
        break;
      }
      case "increaseSummaryFrequency": {
        const idx = Math.min(sumFreqs.length - 1, sumFreqs.indexOf(p.summaryFrequency) + 1);
        p.summaryFrequency = sumFreqs[idx];
        break;
      }
      case "decreaseSummaryFrequency": {
        const idx = Math.max(0, sumFreqs.indexOf(p.summaryFrequency) - 1);
        p.summaryFrequency = sumFreqs[idx];
        break;
      }
    }

    return p;
  }

  /* ─── Decay Epsilon (call at session end) ─── */
  decayEpsilon(): void {
    this.config.epsilon = Math.max(
      this.config.minEpsilon,
      this.config.epsilon * this.config.epsilonDecay,
    );
  }

  /* ─── End-of-Session Batch Adaptation ───
     Called once at session end. Evaluates the completed session's aggregated telemetry,
     computes batch reward, updates Q-values, and applies subtle tuning to transformation
     parameters with threshold safeguards for fundamental preferences.
  */
  async adaptAtSessionEnd(
    profile: FullCognitiveProfile,
    stats: {
      totalHighlights: number;
      totalPauses: number;
      totalSkips: number;
      engagedSections: string[];
      skippedSections: string[];
    },
  ): Promise<{
    actionTaken: Action | "noChange";
    reward: number;
    dominantSignal: "highlight" | "pause" | "skip";
    paramChanges: Array<{ param: string; from: string | number | boolean; to: string | number | boolean }>;
    reason: string;
  }> {
    const { totalHighlights, totalPauses, totalSkips, engagedSections, skippedSections } = stats;
    const dominantSignal = this.computeDominantSignal(stats);
    const totalInteractions = totalHighlights + totalPauses + totalSkips;

    // If virtually no interactions occurred in this session, don't perturb user settings
    if (totalInteractions < 2) {
      return {
        actionTaken: "noChange",
        reward: 0,
        dominantSignal,
        paramChanges: [],
        reason: "Session too brief to infer presentation adjustments.",
      };
    }

    // Compute session net reward
    // High engagement sections and highlights give strong positive reward;
    // excessive skipping signals cognitive fatigue or mismatched density.
    const reward = (totalHighlights * 1.0) + (totalPauses * 0.4) - (totalSkips * 0.8);
    profile.rlState.totalEngagementScore += reward;
    profile.rlState.highlightRate = totalHighlights;
    profile.rlState.pauseRate = totalPauses;
    profile.rlState.skipRate = totalSkips;

    const currentState = discretizeState(profile.rlState);
    const stateKey = stateToKey(currentState);

    if (!this.qTable[stateKey]) {
      this.qTable[stateKey] = new Array(ACTION_COUNT).fill(0);
    }

    // Update Q-table with session reward
    if (this.prevStateKey !== null && this.prevAction !== null) {
      if (!this.qTable[this.prevStateKey]) {
        this.qTable[this.prevStateKey] = new Array(ACTION_COUNT).fill(0);
      }
      const prevQ = this.qTable[this.prevStateKey];
      const actionIdx = ACTIONS.indexOf(this.prevAction);
      const maxNextQ = Math.max(...this.qTable[stateKey]);
      const tdTarget = reward + this.config.discountFactor * maxNextQ;
      prevQ[actionIdx] = prevQ[actionIdx] + this.config.learningRate * (tdTarget - prevQ[actionIdx]);
    }
    // Choose action via epsilon-greedy
    let chosenAction: Action | "noChange" = this.selectAction(profile.rlState);

    // Safeguard Thresholds for fundamental preferences:
    // 1. Never turn OFF visuals if user baseline format is visual or needs concept anchors
    if (chosenAction === "toggleVisualAnchors") {
      const wantsVisuals = profile.baseline.formatPreference === "visual" || profile.baseline.needsConceptAnchor;
      if (wantsVisuals && profile.transformationParams.useVisualAnchors) {
        chosenAction = totalSkips > totalHighlights ? "increaseSummaryFrequency" : "increaseCaptionSpeed";
      }
    }

    // 2. High skip rate threshold guard: if user is skipping heavily, never increase chunk size
    if (totalSkips > (totalHighlights + totalPauses) && chosenAction === "increaseChunkSize") {
      chosenAction = "decreaseChunkSize";
    }

    // 3. High engagement threshold guard: if user is highlighting and not skipping, don't over-simplify
    if (totalHighlights > 4 && totalSkips <= 1 && chosenAction === "increaseSimplification") {
      chosenAction = "noChange";
    }

    this.prevStateKey = stateKey;
    this.prevAction = chosenAction === "noChange" ? null : chosenAction;
    await saveQTable(this.qTable);

    if (chosenAction === "noChange") {
      return {
        actionTaken: "noChange",
        reward,
        dominantSignal,
        paramChanges: [],
        reason: "Stable engagement maintained; no parameter tuning needed.",
      };
    }

    // Apply small adaptation to transformation params
    const oldParams = { ...profile.transformationParams };
    const newParams = this.applyAction(oldParams, chosenAction);
    profile.transformationParams = newParams;

    // Identify changed fields
    const paramChanges: Array<{ param: string; from: string | number | boolean; to: string | number | boolean }> = [];
    (Object.keys(newParams) as Array<keyof TransformationParams>).forEach((k) => {
      if (newParams[k] !== oldParams[k]) {
        paramChanges.push({ param: k, from: oldParams[k], to: newParams[k] });
      }
    });

    let reason = "Refined pacing based on reading rhythm.";
    if (chosenAction.includes("ChunkSize")) {
      reason = totalSkips > totalHighlights ? "Reduced section length to ease reading load." : "Expanded section length for deeper reading flow.";
    } else if (chosenAction.includes("Simplification")) {
      reason = totalSkips > totalHighlights ? "Clarified sentence structure based on skipping pattern." : "Maintained natural phrasing based on steady engagement.";
    } else if (chosenAction.includes("SummaryFrequency")) {
      reason = "Adjusted milestone summaries to reinforce understanding.";
    } else if (chosenAction.includes("CaptionSpeed")) {
      reason = "Synchronized audio pace with your reading speed.";
    }

    return {
      actionTaken: chosenAction,
      reward,
      dominantSignal,
      paramChanges,
      reason,
    };
  }

  /* ─── Compute dominant signal from session stats ─── */
  computeDominantSignal(stats: {
    totalHighlights: number;
    totalPauses: number;
    totalSkips: number;
  }): "highlight" | "skip" | "pause" {
    const { totalHighlights, totalPauses, totalSkips } = stats;
    if (totalHighlights >= totalPauses && totalHighlights >= totalSkips) return "highlight";
    if (totalPauses >= totalSkips) return "pause";
    return "skip";
  }
}
