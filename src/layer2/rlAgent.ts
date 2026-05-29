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

  /* ─── Process a behavior signal → update profile → return reward ─── */
  async processSignal(
    profile: FullCognitiveProfile,
    signal: SignalType,
  ): Promise<{ reward: number; updatedProfile: FullCognitiveProfile }> {
    const { rlState } = profile;

    /* 1. Update rlState counters */
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
        rlState.skipRate += 0.5; /* tab switch is a mild skip */
        break;
    }

    /* 2. Compute reward */
    const reward = SIGNAL_REWARDS[signal];
    rlState.totalEngagementScore += reward;

    /* 3. Update Q-table */
    await this.learn(profile, reward);

    /* 4. Select and apply best action */
    const action = this.selectAction(profile.rlState);
    profile.transformationParams = this.applyAction(profile.transformationParams, action);

    /* 5. Save profile */
    profile.updatedAt = Date.now();
    await updateProfile(profile);
    await broadcastProfileUpdate(profile);

    return { reward, updatedProfile: profile };
  }

  /* ─── Q-Learning Update Step ─── */
  private async learn(profile: FullCognitiveProfile, reward: number): Promise<void> {
    const state = discretizeState(profile.rlState);
    const key = stateToKey(state);

    /* Initialize Q-values for unseen states */
    if (!this.qTable[key]) {
      this.qTable[key] = new Array(ACTION_COUNT).fill(0);
    }

    /* Get current Q-values */
    const qValues = this.qTable[key];

    /* Compute max Q for next state (bootstrap) — we use current state as proxy */
    const maxNextQ = Math.max(...qValues);

    /* For each action, update Q(s,a) = Q(s,a) + lr * (reward + discount * maxQ' - Q(s,a)) */
    /* We apply the update weighted across all actions, but primarily for the "chosen" one.
       In practice, Q-learning updates for the action that was taken. Since we learn from
       the signal reward (not from a specific action), we update all actions proportionally. */
    for (let i = 0; i < ACTION_COUNT; i++) {
      const oldQ = qValues[i];
      const tdTarget = reward + this.config.discountFactor * maxNextQ;
      qValues[i] = oldQ + this.config.learningRate * (tdTarget - oldQ);
    }

    this.qTable[key] = qValues;
    await saveQTable(this.qTable);
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
