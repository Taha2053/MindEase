/* ─── MindEase — Layer 2: RL Agent ───
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

    /* 1. Update rlState counters — this changes the state */
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
