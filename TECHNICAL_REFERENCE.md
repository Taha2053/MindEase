# MindEase — Technical Architecture & System Reference

**Version:** 0.1.0  
**Target Environments:** Google Chrome (Manifest V3) & Mozilla Firefox (Manifest V3 Gecko)  
**Primary Language:** TypeScript (Strict Mode)  
**Build Toolchain:** Vite + `vite-plugin-web-extension` + Vitest

---

## 1. System Overview & Core Purpose

MindEase is an AI-native browser extension engineered specifically for neurodiverse learners (including individuals with ADHD, dyslexia, autism, and multilingual learning needs). Traditional education presents rigid, dense text designed for neurotypical cognitive processing. MindEase intercepts web content in real time and adaptively restructures it into digestible, multi-modal learning representations without modifying or hallucinating original facts.

The system is organized into a modular **3-Layer Cognitive Architecture** coordinated by a background message router, an active study workspace state machine, and five browser entrypoints.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                     BROWSER RUNTIME                                      │
├────────────────────────────────────────┬─────────────────────────────────────────────────┤
│           CONTENT SCRIPT               │             BACKGROUND SERVICE WORKER           │
│  - DOM Traversal & Page Classifier     │  - Session Lifecycle & Workspace State Machine   │
│  - Adaptive Overlay & Tooltips         │  - Layer 1 Annotation & Visual Orchestration    │
│  - KaTeX Formula & Puter TTS Bridge    │  - Layer 2 Q-Learning Reinforcement Learning    │
│  - OCR Crop Tool & Explain Popup       │  - Layer 3 Synthesis, Gaps & Study Artifacts    │
│  - Behavioral Telemetry Tracking       │  - Cross-Layer Message Router & Storage Engine  │
├────────────────────────────────────────┴─────────────────────────────────────────────────┤
│                                   UI ENTRYPOINTS                                         │
│  • Popup (Status, Manual Overrides, Q-Table)                                             │
│  • Onboarding (Multi-factor Baseline Questionnaire & Cognitive Need Calibration)         │
│  • Dashboard (10-Section Visual Analytics, Artifact Explorer, Session History)           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Comprehensive Tool & Provider Reference

MindEase utilizes zero-cost, high-reliability free and developer-tier APIs combined with client-side processing libraries:

| Tool / Provider | Category | Exact Role in MindEase | Mechanism & Endpoint |
|---|---|---|---|
| **Mistral AI** | Large Language Model | Structural content annotation, educational classification, contextual selection explanation | `https://api.mistral.ai/v1/chat/completions` using model `mistral-small-latest`. Operates under strict annotation-only constraints (never rewrites original text). |
| **Napkin AI** | Visual Generation | Automatically generates flowcharts, mind maps, Venn diagrams, and timelines from chunk text | `https://api.napkin.ai/v1/visual` and `/status` polling. Generates vector SVG/PNG diagrams aligned with student needs. |
| **Napkin Proxy** | Local Dev Proxy | Solves Firefox origin blocking (`moz-extension://` restrictions on Napkin endpoints) | Node.js lightweight forwarder (`napkin-proxy.mjs`) on `http://localhost:3001` with path normalization. |
| **Hugging Face (`@huggingface/inference`)** | Illustrative Image Gen | Generates illustrative concept images via FLUX.1-dev for visual-first learners | Model `black-forest-labs/FLUX.1-dev` via fal-ai provider, returning base64/blob visual cards. |
| **OCR.space** | Optical Character Recognition | Extracts raw text and formulas from diagrams, infographics, screenshots, and image context menus | `https://api.ocr.space/parse/image` using `VITE_OCR_SPACE_API_KEY`, supporting both URL and Base64 payloads. |
| **Puter.js / Web Speech API** | Client-side TTS | Free, zero-dependency text-to-speech audio reader | Browser-native `SpeechSynthesis` and Puter bridge in `src/content/puterTts.ts` with queueing and chunk pacing. |
| **KaTeX** | Math Rendering Engine | Renders LaTeX mathematical expressions inline and block-mode | Client-side `katex` package and CDN styling for formulas tagged with `[FORMULA]...[/FORMULA]`. |
| **Lucide Icons** | Iconography | Visual navigation, section icons, and accessibility indicators | `lucide-react` in React components + SVG utility helper in `src/utils/icons.ts`. |
| **webextension-polyfill** | WebExtension API | Unified Promise-based storage, tabs, messaging, and context menu API for Chrome and Firefox | Aliased during Vitest unit testing to in-memory mock `src/__mocks__/webextension-polyfill.ts`. |

---

## 3. 3-Layer Cognitive Architecture

```
                                  [ Educational Webpage / PDF / Video ]
                                                    │
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: REAL-TIME CONTENT TRANSFORMATION                                                              │
│ • Annotation-Only LLM Tagging: [CHUNK], [CONCEPT: ...], [DEF: ...], [EXAMPLE], [FORMULA], [SUMMARY]   │
│ • Progressive Batch Streaming: 3 chunks per batch with 150ms pacing                                   │
│ • Multi-modal Visual Orchestration: Napkin SVG diagrams + FLUX illustrative visuals                   │
│ • KaTeX Mathematical typesetting + OCR space screenshot extraction + Puter.js Audio TTS               │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │ Content Chunks & Visuals
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: ADAPTIVE COGNITIVE PROFILING (Q-LEARNING RL AGENT)                                            │
│ • Discretized State Space: 81 States (Highlight, Pause, Re-read, Skip levels ∈ {0, 1, 2})              │
│ • Action Space (9 Actions): Adjust chunk size, simplification, caption speed, visuals, summaries       │
│ • Reward Function: Highlight (+1.0), Pause (+0.5), Re-read (0.0), Tab Switch (-0.5), Skip (-1.0)       │
│ • User Override Engine: Manual user preferences take precedence over RL recommendations                │
│ • Explainability Layer: Generates plain-English explanations for every adaptation decision             │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │ Behavioral Events & Profile
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: SESSION MEMORY & SYNTHESIS                                                                    │
│ • Session State Machine: Multi-tab workspace tracking (Active → Passive → Suspended → Ended)          │
│ • Engagement Classifier: Computes engagement score per chunk (Clamped [0.0, 1.0])                      │
│ • Gap Analyzer: Flags skipped (<0.15), skimmed (0.15–0.30), and rushed (0.30–0.45) content             │
│ • Cross-Source Connection Detector: Discovers shared concepts across tabs, PDFs, and notes            │
│ • Knowledge Artifact Generator: Produces 7-section study report + personalized flashcards              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Layer Deep Dives

### 4.1 Layer 1 — Content Transformation (`src/layer1/`)

1. **Non-Destructive Annotation Strategy:**
   The prompt architecture explicitly forbids rephrasing or deleting source material. Structural tags are inserted around verbatim text:
   - `[CHUNK n]`: Delimits discrete information units according to the target chunk size.
   - `[CONCEPT: Label]`: Flags key technical ideas for knowledge graph linking.
   - `[DEF: Term]`: Marks complex vocabulary for interactive hover tooltips (essential for second-language learners).
   - `[EXAMPLE] ... [/EXAMPLE]`: Flags concrete illustrations so they can be hoisted or collapsed.
   - `[FORMULA] ... [/FORMULA]`: Encapsulates mathematical statements for KaTeX typesetting.
   - `[SUMMARY: ...]`: Provides high-level synthesis per chunk.

2. **Parser Robustness (`parseAnnotatedContent`):**
   Handles edge cases including inline chunk declarations, unclosed tags, markdown backtick stripping, and graceful fallback when raw plain text lacks tags.

3. **Visual Orchestrator (`visualOrchestrator.ts`):**
   - Automatically checks `STORAGE_KEYS.VISUALS_CACHE` before firing API calls.
   - Triggers Napkin AI requests for structural conceptual diagrams (flowcharts, mindmaps).
   - Triggers Hugging Face FLUX.1-dev for pictorial illustrations when learner profile specifies `formatPreference: "visual"`.
   - Prunes cache at 20 entries or 8MB storage limit to prevent storage exhaustion.

### 4.2 Layer 2 — Reinforcement Learning Cognitive Agent (`src/layer2/`)

#### Mathematical Formulation
The adaptive engine models learner interaction as a Markov Decision Process (MDP) solved via Q-learning:

1. **State Space $S$ ($3^4 = 81$ discrete states):**
   Interaction telemetry is accumulated into 4 rate counters:
   - `highlightRate`, `pauseRate`, `reReadRate`, `skipRate`
   Each rate $r$ is mapped to a discrete level $L \in \{0, 1, 2\}$:
   $$L(r) = \begin{cases} 0 & r \le 0 \\ 1 & 0 < r \le 5 \\ 2 & r > 5 \end{cases}$$
   State key format: `"${highlightLevel}-${pauseLevel}-${reReadLevel}-${skipLevel}"`

2. **Action Space $A$ (9 discrete actions):**
   $$A = \{\text{increaseChunkSize}, \text{decreaseChunkSize}, \text{increaseSimplification}, \text{decreaseSimplification}, \text{increaseCaptionSpeed}, \text{decreaseCaptionSpeed}, \text{toggleVisualAnchors}, \text{increaseSummaryFrequency}, \text{decreaseSummaryFrequency}\}$$

3. **Reward Function $R(s, a)$:**
   Signals received from content telemetry are mapped to instantaneous scalar rewards:
   - `highlight`: $+1.0$ (strong active interest and comprehension)
   - `pause`: $+0.5$ (deliberate contemplation)
   - `reRead`: $0.0$ (neutral clarification attempt)
   - `tabSwitch`: $-0.5$ (mild loss of focus)
   - `skip`: $-1.0$ (cognitive overload or disengagement)

4. **Bellman Q-Value Update:**
   $$Q(s_t, a_t) \leftarrow Q(s_t, a_t) + \alpha \left[ R_{t+1} + \gamma \max_{a} Q(s_{t+1}, a) - Q(s_t, a_t) \right]$$
   - Learning rate $\alpha = 0.1$
   - Discount factor $\gamma = 0.9$

5. **Action Selection ($\epsilon$-Greedy with Decay):**
   With probability $\epsilon$, explore a random action $a \in A$; with probability $1 - \epsilon$, exploit $\arg\max_a Q(s, a)$.
   - Initial $\epsilon = 0.30$
   - Decay rate per session: $\epsilon \leftarrow \max(0.01, \epsilon \times 0.99)$

6. **User Override Hierarchy:**
   If a user sets manual controls in the popup, `applyOverridesToParams` overrides RL agent parameters while preserving learning updates in the background Q-table.

### 4.3 Layer 3 — Session Memory & Synthesis (`src/layer3/`)

1. **Engagement Scoring Model:**
   Each content chunk begins at neutral score $0.50$ and updates dynamically:
   $$\text{score} \leftarrow \text{clamp}_{[0, 1]}(\text{score} + \Delta_{\text{event}})$$
   - `highlight`: $+0.40$
   - `pause`: $+0.25$
   - `re-read`: $+0.20$
   - `skip`: $-0.40$
   - `fast-scroll`: $-0.20$

2. **Gap Severity Classifier:**
   - **Skipped** ($\text{score} < 0.15$): User bypassed entirely. Flagged with highest review priority.
   - **Skimmed** ($0.15 \le \text{score} < 0.30$): Scrolled too quickly to absorb. Flagged with medium priority.
   - **Rushed** ($0.30 \le \text{score} < 0.45$): Incomplete reading duration. Flagged with low priority.
   - **Engaged** ($\text{score} \ge 0.45$): Absorbed. Excluded from gaps list.

3. **Cross-Source Connection Detection:**
   Extracts n-grams and concept tags across visited tabs and aggregated notes, filtering stop words and calculating Jaccard concept similarity:
   $$J(A, B) = \frac{|A \cap B|}{|A \cup B|}$$
   Pairs with $J(A, B) \ge 0.25$ are grouped into cross-source concept clusters.

4. **Personalized 7-Section Knowledge Artifact:**
   - **1. Resources Used:** Tab titles, URLs, timestamps, duration, notes count.
   - **2. Key Concepts:** Identified terms, occurrences, aggregated engagement score.
   - **3. User Notes:** Highlighted passages and user annotations.
   - **4. Needs Review:** Prioritized gap list with source links and missed text excerpts.
   - **5. Study Cards:** Formatted flashcards tailored to cognitive profile (chunked text, spaced lists, visual cards, or audio summaries).
   - **6. Focus Summary:** Total study time, focused time, interruption count, longest distraction duration, focus score percentage.
   - **7. Resource Summary:** Per-source analytical breakdown.

---

## 5. Study Workspace State Machine (`SessionManager.ts`)

The study session lifecycle tracks student attention across multiple browser tabs:

```
                  ┌──────────────┐
                  │    ENDED     │
                  └──────┬───────┘
                         │ Tab Registered / Start Session
                         ▼
                  ┌──────────────┐
       ┌─────────►│    ACTIVE    │◄──────────┐
       │          └──────┬───────┘           │ User Activity
       │                 │ 5 min idle        │
       │                 ▼                   │
       │          ┌──────────────┐           │
User Activity     │   PASSIVE    ├───────────┤
       │          └──────┬───────┘           │
       │                 │ 30 min passive    │
       │                 ▼                   │
       │          ┌──────────────┐           │
       └──────────┤  SUSPENDED   ├───────────┘
                  └──────┬───────┘
                         │ 60 min in suspended OR All Tabs Closed
                         ▼
                  ┌──────────────┐
                  │    ENDED     │
                  └──────────────┘
```

- **Active:** User scrolling, highlighting, reading, or navigating tabs within the session.
- **Passive:** 5 minutes without activity on study tabs.
- **Suspended:** 30 minutes in passive mode. Distraction timer logs uninterrupted break duration.
- **Ended:** Closes session, triggers Layer 3 artifact assembly, writes history entry to storage, and auto-opens the dashboard.

---

## 6. Message Passing Contract (`src/types/index.ts`)

Cross-process communication between Background Service Worker, Content Scripts, Popup, Onboarding, and Dashboard uses strictly typed runtime messages:

| Message Type | Direction | Payload Structure | Purpose |
|---|---|---|---|
| `TRANSFORM_CONTENT` | Content → Background | `{ text, pageType }` | Request Layer 1 LLM annotation and chunking |
| `TRANSFORMED_CONTENT` | Background → Content | `{ chunks, baseline, transformationParams, append, done }` | Streams structured chunk batches to overlay |
| `GENERATE_VISUALS` | Content → Background | `{ chunks, concepts, useFlux }` | Trigger visual generation for chunks/concepts |
| `VISUALS_READY` | Background → Content | `{ visuals: VisualEntry[] }` | Delivers generated Napkin/Flux visuals |
| `BEHAVIOR_SIGNAL` | Content → Background | `{ signal, timestamp, context }` | Sends user action telemetry to Layer 2 RL agent |
| `COGNITIVE_EVENT` | Layer 2 → Layer 3 | `{ type, contentChunkId, sourceId, sourceType, profile, durationMs }` | Emits score update to SessionTracker |
| `SESSION_START` | UI / Content → Background | `{ userId, url, title, sourceType }` | Starts workspace and tracking session |
| `SESSION_END` | UI → Background | `{}` | Ends active session and compiles artifact |
| `ARTIFACT_READY` | Layer 3 → UI | `PersonalizedArtifact` | Notifies dashboard/popup of completed synthesis |
| `HIGHLIGHT_NOTE` | Content → Background | `{ text, url, title, tabId, sectionId }` | Saves highlight into tab notes and aggregated collection |
| `HIGHLIGHTS_GET` | UI → Background | `{}` | Requests all aggregated highlight notes |
| `HIGHLIGHTS_DATA` | Background → UI | `{ notes: HighlightNote[] }` | Returns aggregated notes list |
| `CLASSIFY_CONTENT` | Content → Background | `{ title, snippet }` | Requests LLM decision: educational vs entertainment |
| `CLASSIFY_CONTENT_RESULT`| Background → Content | `{ classification: "educational" \| "entertainment" }` | Returns content classification |
| `EXPLAIN_SELECTION` | Content → Background | `selectedText` | Requests concise tutor explanation |
| `EXPLAIN_SELECTION_RESULT`| Background → Content | `{ text, explanation }` | Delivers generated explanation |
| `OCR_IMAGE` | Content → Background | `{ imageUrl?, base64Image? }` | Requests OCR.space text extraction |
| `OCR_RESULT` | Background → Content | `{ imageUrl, text?, error? }` | Returns extracted OCR text or error |
| `TTS_SPEAK` | Content ↔ Background | `{ text }` | Controls text-to-speech reading |
| `TTS_STOP` | Content ↔ Background | `{}` | Stops ongoing speech synthesis |

---

## 7. Storage Engine Schema

All persistent state is stored locally via `browser.storage.local`:

```typescript
const STORAGE_KEYS = {
  PROFILE:               "mindease_profile",               // FullCognitiveProfile
  QTABLE:                "mindease_qtable",                // QTable (81 states × 9 action Q-values)
  ONBOARDING_DONE:       "mindease_onboarding_done",       // boolean
  SESSION_ACTIVE:        "mindease_session_active",        // boolean
  SESSION_STATS:         "mindease_session_stats",         // SessionStats
  WORKSPACE:             "mindease_workspace",             // WorkspaceSession
  NOTES:                 "mindease_notes",                 // NotesCollection
  EXPLANATIONS:          "mindease_explanations",          // ExplanationMap
  OVERRIDES:             "mindease_overrides",             // UserOverrides
  VISUALS_CACHE:         "mindease_visuals_cache",         // VisualsCache
  EXTENSION_ACTIVE:      "mindease_extension_active",      // boolean
  EXCLUDED_TABS:         "mindease_excluded_tabs",         // number[]
  SESSION_HISTORY:       "mindease_session_history",       // SessionHistoryEntry[]
  SESSION_CHUNKS:        "mindease_session_chunks",        // ContentChunk[]
  ACTIVE_LAYER3_SESSION: "mindease_active_layer3_session", // SessionLog
  LATEST_ARTIFACT:       "latestArtifact",                 // PersonalizedArtifact
} as const;
```

---

## 8. Cross-Browser Manifest V3 Architecture

MindEase compiles cleanly into dedicated bundles for both **Google Chrome** and **Mozilla Firefox**:

1. **Chrome Build (`dist/chrome/`):**
   - Background runs as an ES module service worker: `"background": { "service_worker": "src/background/index.ts", "type": "module" }`.
   - Permissions include `storage`, `activeTab`, `scripting`, `contextMenus`.

2. **Firefox Build (`dist/firefox/`):**
   - Background runs as background scripts: `"background": { "scripts": ["src/background/index.ts"], "type": "module" }`.
   - Strips unsupported Chrome-only permissions (`sidePanel`, `downloads`).
   - Injects Gecko ID `"mindease@architects.ensit"` and `strict_min_version: "109.0"`.
   - Adapts CSP rules for local extension page styles and SVG rendering.

---

## 9. Verification & Invariant Proofs

The test suite validates invariants across all layers:
- **`src/layer1/layer1.test.ts`**: Verifies structured chunking, definition flags, formula tags, example tag containment, and fallback parsing.
- **`src/layer2/layer2.test.ts`**: Verifies 81-state discretization, state key hashing, Q-value Bellman updates, reward propagation, user override precedence, and explainability text generation.
- **`src/layer3/layer3.test.ts`**: Verifies engagement score bounding in $[0.0, 1.0]$, gap threshold severity categorization, Jaccard connection detection, card formatting per cognitive need, and artifact schema integrity.
- **`src/session/session.test.ts`**: Verifies workspace lifecycle transitions, per-tab highlight tracking, and focus metric calculations.
