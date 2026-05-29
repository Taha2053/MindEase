# MindEase — Layer 2: Adaptive Cognitive Profiling

> **Owner:** Taha  
> **Status:** Complete  
> **Branch:** `feature/layer2-cognitive-profiling`

---

## 1. Overview

Layer 2 (Adaptive Cognitive Profiling) is the brain of MindEase. It builds and evolves a **living model** of how the user's brain processes information. Unlike a static questionnaire, Layer 2 uses a **Q-learning reinforcement learning agent** that continuously adapts the extension's behavior based on real-time signals: which content the user highlights, where they pause to read, what they skip, and when they switch tabs.

**Why it exists:** Every learner's brain is different. A dyslexic user needs smaller chunks and visual anchors. An ADHD user needs high-frequency summaries and fast caption speeds. A second-language learner needs stronger simplification. Layer 2 discovers these needs dynamically — no two profiles ever converge to the same parameters.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Extension (MV3)                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │  Content     │    │  Background   │    │    Popup        │  │
│  │  Script      │───▶│  SW (Router)  │◀───│    (Profile)   │  │
│  │  (listener)  │    │              │    └─────────────────┘  │
│  └─────────────┘    │  ┌──────────┐ │                        │
│                     │  │ Layer 2  │ │                        │
│                     │  │ RL Agent │ │                        │
│                     │  │ Q-table  │ │                        │
│                     │  │ Profile  │ │                        │
│                     │  │ Manager  │ │                        │
│                     │  └──────────┘ │                        │
│                     └───────────────┘                        │
│                           │                                  │
│                           ▼                                  │
│                     ┌──────────────┐                         │
│                     │  Layer 3     │                         │
│                     │  Session     │                         │
│                     │  Memory      │                         │
│                     └──────────────┘                         │
│                                                              │
│  ┌──────────────────────────────────────────────────┐        │
│  │           chrome.storage.local                    │        │
│  │  mindease_profile | mindease_qtable | session    │        │
│  └──────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Content Script** (`src/content/index.ts`) detects user behavior (scroll, highlight, tab switch)
2. Emits `BEHAVIOR_SIGNAL` message to background
3. **Layer 2 listener** in `src/layer2/index.ts` catches the signal
4. **RL Agent** (`src/layer2/rlAgent.ts`) processes the signal:
   - Updates rlState counters
   - Computes reward
   - Updates Q-table
   - Selects next action (epsilon-greedy)
   - Applies action to transformationParams
   - Saves profile back to storage
5. **Layer 3** receives `SESSION_END` at session close for knowledge artifact generation
6. **Layer 1** can request the current profile via `GET_PROFILE` to apply transformationParams

---

## 3. File-by-File Breakdown

### `src/types/index.ts` — Shared Types
Extended with all Layer 2 types: `FullCognitiveProfile`, `BaselineProfile`, `RLState`, `TransformationParams`, `QTable`, `BehaviorSignalMessage`, `SessionStats`, `SessionEndPayload`, `ACTION_COUNT`, `ACTIONS`, `DiscreteState`, `STORAGE_KEYS`. Also includes `discretizeState()` and `stateToKey()` helper functions.

### `src/layer2/index.ts` — Layer 2 Entry Point
- `setupLayer2Listeners()` — registers message handlers for `BEHAVIOR_SIGNAL`, `GET_PROFILE`, `SESSION_END`, `RESET_PROFILE`, `ONBOARDING_COMPLETE`
- `handleBehaviorSignal()` — routes signals to RL agent and updates session stats
- `endSession()` — computes session summary, emits `SESSION_END` to Layer 3
- `resetEverything()` — wipes profile, Q-table, and all session data
- `emitCognitiveEvent()` — sends individual cognitive events to Layer 3
- `getCurrentProfile()` — returns the profile from storage

### `src/layer2/rlAgent.ts` — Q-Learning Agent
The core RL engine. See Section 4 for full deep-dive.
- `processSignal(profile, signal)` — updates counters, computes reward, learns, selects action
- `selectAction(rlState)` — epsilon-greedy selection
- `applyAction(params, action)` — mutates transformation params
- `learn(profile, reward)` — Q-table update step
- `decayEpsilon()` — called at session end
- `computeDominantSignal(stats)` — determines if user mostly highlighted, paused, or skipped

### `src/layer2/profileManager.ts` — Profile CRUD
- `createProfile(baseline)` — builds initial profile from onboarding answers
- `getProfile()` — reads from storage
- `updateProfile(profile)` — writes updated profile
- `deleteProfile()` — wipes all stored data
- `getQTable()` / `saveQTable()` — Q-table persistence
- `getSessionStats()` / `saveSessionStats()` / `clearSessionStats()` — session stats
- `isOnboardingDone()` — checks if onboarding was completed
- `broadcastProfileUpdate()` — sends `PROFILE_UPDATED` to all listeners (Layer 1 & 3)

### `src/layer2/onboarding/onboarding.html` — Onboarding HTML
Clean, accessible HTML structure with step indicator, question card, and navigation buttons.

### `src/layer2/onboarding/onboarding.ts` — Onboarding Logic
One-question-at-a-time flow with 5 questions. Saves baseline profile to storage, then notifies background.

### `src/layer2/onboarding/onboarding.css` — Onboarding Styles
Deep navy (#0f1724) background, accent #4EB8FF, increased letter-spacing, radio buttons with circle indicators.

### `src/background/index.ts` — Background Service Worker
- Calls `setupLayer2Listeners()` to register Layer 2 handlers
- Opens onboarding tab on first install
- Listens for tab close to trigger session end
- Routes messages between layers

### `src/content/index.ts` — Content Script (Behavior Tracking)
Tracks 5 signals:
- **highlight**: text selection via `mouseup` event
- **pause**: scroll stops for >3 seconds (debounced)
- **reRead**: scrolls back up to a previously visited section
- **skip**: scrolls past content at >1.5px/ms (very fast)
- **tabSwitch**: `visibilitychange` event when tab is hidden

Emits `BEHAVIOR_SIGNAL` messages with URL and section ID context.

### `src/popup/popup.html` — Popup UI
Shows profile summary, session stats, transformation params, and action buttons.

### `src/popup/popup.ts` — Popup Logic
Reads profile from storage, renders stats, binds End Session and Reset Profile buttons.

---

## 4. RL Agent Deep-Dive

### State Space

The agent's state is derived from the current `rlState` counters in the profile. Each counter (highlightRate, pauseRate, reReadRate, skipRate) is **discretized** into 3 levels:

| Level | Range      | Meaning              |
|-------|------------|----------------------|
| 0     | rate === 0 | No activity          |
| 1     | 1 ≤ rate ≤ 5 | Moderate activity  |
| 2     | rate > 5   | High activity        |

The state is encoded as a string key: `"highlightLevel-pauseLevel-reReadLevel-skipLevel"` (e.g., `"2-1-0-1"`).

Total possible states: 3⁴ = **81 states**.

### Action Space (9 actions)

| Action                         | Effect                                          |
|--------------------------------|-------------------------------------------------|
| `increaseChunkSize`            | small → medium → large                          |
| `decreaseChunkSize`            | large → medium → small                          |
| `increaseSimplification`       | 1 → 2 → 3 (more simplified)                    |
| `decreaseSimplification`       | 3 → 2 → 1 (less simplified)                    |
| `increaseCaptionSpeed`         | slow → normal → fast                            |
| `decreaseCaptionSpeed`         | fast → normal → slow                            |
| `toggleVisualAnchors`          | on ↔ off                                        |
| `increaseSummaryFrequency`     | low → medium → high                             |
| `decreaseSummaryFrequency`     | high → medium → low                             |

Each action clamps to its valid range.

### Reward Function

| Signal       | Reward | Rationale                                      |
|--------------|--------|-------------------------------------------------|
| `highlight`  | +1.0   | Strong engagement — user found something useful |
| `pause`      | +0.5   | Moderate engagement — reading carefully         |
| `reRead`     | 0.0    | Neutral — could be confusion or review          |
| `skip`       | -1.0   | Disengagement — content wasn't right            |
| `tabSwitch`  | -0.5   | Mild disengagement — attention break            |

### Q-Table Structure

```json
{
  "0-0-0-0": [0.1, 0.0, -0.2, 0.0, 0.3, -0.1, 0.0, 0.2, 0.0],
  "1-0-0-0": [0.5, 0.2, 0.3, 0.1, 0.6, 0.0, 0.4, 0.3, 0.1],
  ...
}
```

- **Key**: discretized state string
- **Value**: array of 9 Q-values (one per action, in order defined by `ACTIONS`)
- **Storage**: `chrome.storage.local` under key `"mindease_qtable"`

### Epsilon-Greedy Explained

```
epsilon = 0.3  (starts at 30% exploration)

With probability epsilon:
  → Choose a random action (explore)
With probability (1 - epsilon):
  → Choose the action with highest Q-value (exploit)

At end of each session:
  epsilon = max(0.01, epsilon * 0.99)  // decays by 1%
```

This means early sessions explore more (trying different chunk sizes, speeds, etc.), while later sessions increasingly exploit what has been learned.

### Q-Learning Update Rule

For each state `s` (after receiving a reward `r`):

```
Q(s, a) ← Q(s, a) + α * [r + γ * max Q(s', a') - Q(s, a)]
```

Where:
- `α` (learning rate) = 0.1
- `γ` (discount factor) = 0.9
- `r` = reward from the signal
- `max Q(s', a')` = best Q-value for the next state (bootstrapped from current state as proxy)

---

## 5. Full Cognitive Profile Schema

```typescript
interface FullCognitiveProfile {
  userId:        string;        // UUID v4, generated on onboarding
  learningStyle: LearningStyle; // Inferred alias: "visual" | "text" (mirrors baseline.formatPreference)
  condition:     CognitiveNeed; // Inferred: "multilingual" if secondLanguageLearner, else "none"
  createdAt:     string;        // ISO timestamp
  updatedAt:     number;        // Unix ms — updated on every RL action

  baseline: {
    formatPreference:      "visual" | "text";
    attentionSpan:         "short" | "medium" | "long";
    readingPace:           "slow" | "moderate" | "fast";
    needsConceptAnchor:    boolean;
    secondLanguageLearner: boolean;
  };

  rlState: {
    highlightRate:        number; // total highlights this session
    pauseRate:            number; // total pauses
    reReadRate:           number; // total re-reads
    skipRate:             number; // total skips
    sessionCount:         number; // completed sessions lifetime
    totalEngagementScore: number; // cumulative reward sum
  };

  transformationParams: {
    chunkSize:           "small" | "medium" | "large";
    simplificationLevel: 1 | 2 | 3;
    captionSpeed:        "slow" | "normal" | "fast";
    useVisualAnchors:    boolean;
    summaryFrequency:    "high" | "medium" | "low";
  };
}
```

### Design Note: condition field

MindEase deliberately does not ask users to self-diagnose. The `condition` field is
inferred from behavior: if the user studies in a second language, `condition` is set
to `"multilingual"` and simplification/chunking parameters are initialized more
aggressively. The `"dyslexia"` and `"adhd"` values are reserved for a future version
that may infer these from RL behavior patterns over multiple sessions — for example,
persistently high skip rates combined with short attention span could suggest ADHD-like
engagement patterns, triggering a parameter preset without requiring a diagnosis label.

### Field Reference

| Field | Set by | Changes how |
|-------|--------|-------------|
| `baseline.*` | Onboarding (once, never changes) | Seeds initial transformationParams |
| `learningStyle` | Inferred from `baseline.formatPreference` | Convenience alias for Layer 1 |
| `condition` | Inferred from `baseline.secondLanguageLearner` | Adjusts initial simplification aggressiveness |
| `rlState.*` | Incremented by behavior signals | Drives RL state discretization |
| `rlState.sessionCount` | +1 on every `endSession()` | Controls epsilon decay |
| `rlState.totalEngagementScore` | Cumulative reward sum | Long-term engagement indicator |
| `transformationParams.*` | Seeded from baseline, mutated by RL agent | Consumed directly by Layer 1 |

---

## 6. Integration Guide for Layer 1 (Content Transformation)

Layer 1 should request the current cognitive profile **at page load** and **after each profile update** to apply the correct transformation parameters.

### Requesting the Profile

```typescript
import browser from "webextension-polyfill";

async function getCurrentParams() {
  const response = await browser.runtime.sendMessage({ type: "GET_PROFILE" });
  if (response && response.type === "PROFILE_DATA") {
    const profile = response.profile; // FullCognitiveProfile
    const params = profile.transformationParams;
    // Use params.chunkSize, params.simplificationLevel, etc.
    return params;
  }
  return null; // No profile yet (pre-onboarding)
}
```

### Listening for Profile Updates

```typescript
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; payload: unknown };
  if (msg.type === "PROFILE_UPDATED") {
    const profile = msg.payload as FullCognitiveProfile;
    // Re-apply transformation params
    applyTransformation(profile.transformationParams);
  }
});
```

### How to Use transformationParams

| Parameter | What Layer 1 should do |
|-----------|----------------------|
| `chunkSize` | Split content into small (~200 words), medium (~500), or large (~1000+) chunks |
| `simplificationLevel` | 1 = original text, 2 = simplified vocab + shorter sentences, 3 = heavily simplified |
| `captionSpeed` | Control video caption playback speed or text reveal speed |
| `useVisualAnchors` | Insert diagrams, icons, and visual markers alongside text |
| `summaryFrequency` | Insert summaries: high = after every chunk, medium = every 3 chunks, low = at section end |

---

## 7. Integration Guide for Layer 3 (Session Memory & Synthesis)

Layer 3 should listen for `SESSION_END` messages to generate knowledge artifacts.

### Listening for SESSION_END

```typescript
import browser from "webextension-polyfill";
import type { SessionEndPayload } from "@/types";

browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; payload: unknown };
  if (msg.type === "SESSION_END") {
    const payload = msg.payload as SessionEndPayload;
    const { sessionStats, updatedProfile } = payload;

    // sessionStats.engagedSections — sections user engaged with
    // sessionStats.skippedSections — sections user skipped
    // sessionStats.dominantSignal — overall engagement pattern
    // updatedProfile — full profile at session end

    generateArtifact(sessionStats, updatedProfile);
  }
});
```

### What's in sessionStats

| Field | Type | Description |
|-------|------|-------------|
| `engagedSections` | `string[]` | Section IDs where user highlighted or paused |
| `skippedSections` | `string[]` | Section IDs where user scrolled quickly |
| `totalHighlights` | `number` | Total highlight events |
| `totalPauses` | `number` | Total pause events |
| `totalSkips` | `number` | Total skip events |
| `dominantSignal` | `"highlight" \| "skip" \| "pause"` | Which signal type occurred most |

### Cognitive Events (during session)

Layer 3's session tracker can also listen for individual `COGNITIVE_EVENT` messages sent by Layer 2 for real-time tracking:

```typescript
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; payload: unknown };
  if (msg.type === "COGNITIVE_EVENT") {
    const event = msg.payload;
    // event.type — "highlight" | "pause" | "reRead" | "skip" | "tabSwitch"
    // event.contentChunkId — which section
    // event.sourceId — URL
    // event.sourceType — "pdf" | "website" | "video" | "lecture"
    // event.timestamp — when it happened
    // event.profile — current profile at time of event
  }
});
```

---

## 8. How to Compile and Load in Chrome / Firefox

### Prerequisites

- Node.js 18+
- npm

### Development

```bash
# Install dependencies
npm install

# Chrome (with HMR)
npm run dev:chrome

# Firefox (with HMR)
npm run dev:firefox
```

### Build

```bash
# Build for Chrome
npm run build:chrome
# Output: dist/chrome/

# Build for Firefox
npm run build:firefox
# Output: dist/firefox/
```

### Load in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Navigate to `dist/chrome/` (or the root project directory if using source)
5. The extension should appear with the MindEase icon

### Load in Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Navigate to `dist/firefox/manifest.json`
4. The extension is now loaded for testing

### TypeScript Compilation (if not using Vite)

The project uses Vite for building, but you can also compile directly with `tsc`:

```bash
npx tsc --noEmit  # Type-check only
```

---

## 9. Known Limitations & Next Steps

### Limitations

1. **State space granularity**: 3 levels per counter (81 states) is coarse. A production version should use more granular discretization or a function approximator (e.g., neural network).
2. **No negative reward for non-action**: If the user does nothing, no learning happens. Could add an idle timeout signal.
3. **Single-agent**: One Q-table per user. No multi-agent or hierarchical RL.
4. **No temporal difference beyond one step**: The Q-update bootstraps from current state. A full TD(λ) or Monte Carlo approach would be more sample-efficient.
5. **Session stats per URL only**: No cross-session long-term memory of specific content domains.
6. **No A/B testing**: All users start with the same epsilon/learning rate. Could personalize hyperparameters based on convergence speed.
7. **`condition` field is partially implemented**: `"dyslexia"` and `"adhd"` are valid enum values but never set — condition is currently inferred from `secondLanguageLearner` only. Future versions could infer these from long-term RL behavior patterns (e.g. persistently high skip rates + short attention span → ADHD-like preset).

### Next Steps

1. **Multi-armed bandit warm-start**: Use a simple epsilon-greedy bandit before main Q-learning kicks in (first 2–3 sessions).
2. **Contextual features**: Add URL domain and content type to the state space so the agent learns different preferences for different subjects.
3. **Persistent Q-table merging**: Allow Q-tables to be backed up to a remote server for cross-device learning.
4. **Human feedback loop**: Add a thumbs-up/down button in the popup to provide explicit reward signals.
5. **Expert system fallback**: If Q-table is sparse, fall back to rule-based heuristics (e.g., "if skipRate > 5, decrease chunk size").
6. **Bayesian uncertainty**: Track uncertainty in Q-values and use it for better exploration (Thompson sampling).
7. **Firefox Android support**: Test and adjust for Firefox on Android.
