# 🧠 MindEase — Adaptive Learning Browser Extension

**Learn the way your brain was meant to.**

MindEase is an AI-native browser extension (Manifest V3) designed for neurodiverse learners (ADHD, dyslexia, autism, and multilingual students). Instead of forcing students into dense, rigid text layouts, MindEase intercepts educational pages, PDFs, and lectures in real time, transforming them into structured, adaptive chunks with KaTeX math rendering, interactive definitions, AI-generated diagrams, text-to-speech audio, and personalized post-session synthesis.

---

## 🌟 Why MindEase?

Traditional education materials are structured for a single, uniform way of thinking. When a neurodiverse learner encounters dense walls of text:
- Long paragraphs trigger cognitive fatigue and working memory overload.
- Unstructured mathematical formulas create visual parsing barriers.
- Technical vocabulary without context disrupts comprehension.
- Missed or skimmed concepts go unnoticed until exam time.

MindEase addresses this without rewriting or simplifying away factual content. It **annotates and restructures** original material into adaptive presentations tailored to each student's cognitive profile, while an online Reinforcement Learning (Q-learning) agent continually optimizes presentation parameters based on real interaction telemetry.

---

## 🧩 Architecture at a Glance

MindEase operates through a 3-Layer Cognitive Architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 1 — Real-Time Content Transformation (Mistral + Visuals + KaTeX)     │
│  • Non-destructive LLM structural annotation (chunks, concepts, formulas)   │
│  • Automated Napkin AI diagrams (flowcharts, mindmaps) & FLUX illustrations │
│  • Free Puter.js / Web Speech TTS & OCR.space image text extraction         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Profile & Parameters
┌──────────────────────────────────────▼──────────────────────────────────────┐
│  Layer 2 — Adaptive Cognitive Profiling (Q-Learning RL Agent)               │
│  • 81 Discrete Cognitive States (Highlight, Pause, Re-read, Skip rates)     │
│  • 9 Actions: Dynamically adjusts chunk size, summaries, visual anchors    │
│  • Transparent User Controls: Manual overrides always take precedence       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Behavioral Telemetry
┌──────────────────────────────────────▼──────────────────────────────────────┐
│  Layer 3 — Session Memory & Synthesis (Multi-Tab Workspace)                 │
│  • Real-time engagement scoring & knowledge gap classification              │
│  • Cross-source concept connection detection across tabs and PDFs           │
│  • Generates 7-section Knowledge Artifact & personalized study cards        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

- **Non-Destructive Content Transformation:** Preserves 100% of original text, equations, and examples while wrapping them into scannable chunks.
- **Formula Typesetting with KaTeX:** Automatically identifies LaTeX and mathematical formulas in text and renders them cleanly.
- **Smart AI Visuals & Diagrams:** Automatically generates Napkin AI flowcharts and HuggingFace FLUX illustrations for conceptual anchors.
- **Interactive Vocabulary & Definitions:** Tooltip definitions for complex terms—especially helpful for second-language learners.
- **Free Built-in Text-to-Speech:** Zero-configuration client-side speech synthesis with pacing and progress tracking.
- **OCR Text Extraction & Explainer:** Right-click any image, formula, or diagram to extract text or get a concise tutor explanation.
- **Online Reinforcement Learning:** Q-learning agent adjusts presentation parameters automatically without clinical surveys.
- **Multi-Tab Study Workspace:** Tracks active study time, filters distractions, and logs interruptions.
- **Comprehensive Post-Session Dashboard:** 10 visual analytical sections, flashcards, knowledge gaps, and exportable artifacts.

---

## 🛠️ Tech Stack & Free Services

- **Runtime:** TypeScript (Strict Mode), React 19, Vite, `vite-plugin-web-extension`
- **Target Browsers:** Google Chrome (MV3) & Mozilla Firefox (MV3 Gecko)
- **AI & LLM Services:**
  - **Mistral AI (`mistral-small-latest`)**: Fast, accurate structural tagging and contextual explanations.
  - **Napkin AI**: Automated vector diagrams, flowcharts, and mind maps.
  - **HuggingFace Inference (`FLUX.1-dev`)**: Conceptual illustrations.
  - **OCR.space**: Free image OCR text extraction.
- **Client-Side Engines:**
  - **KaTeX**: Fast math typesetting.
  - **Web Speech / Puter.js**: Browser-native text-to-speech without external audio servers.
  - **Local Storage**: Fully private; all Q-tables, profiles, notes, and session logs stay in `browser.storage.local`.

---

## 📦 Installation & Setup

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or uv/pnpm

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Taha2053/MindEase.git
cd MindEase
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Mistral AI API Key (required for content transformation & explanation)
VITE_MISTRAL_API_KEY=your_mistral_api_key_here

# Napkin AI API Key (optional — for automated diagram generation)
VITE_NAPKIN_API_KEY=your_napkin_api_key_here

# HuggingFace Token (optional — for FLUX illustrative image generation)

# OCR.space API Key (optional — for image text extraction)
VITE_OCR_SPACE_API_KEY=your_ocr_space_api_key_here
```

For web-wide related-lesson recommendations, place `TAVILY_API_KEY` in the ignored **`server/.env`** file (not a `VITE_` variable). Start the backend with `uv run --directory server uvicorn main:app --reload` and set the extension's Premium Server URL to `http://localhost:8000` if it differs from the default. Tavily Basic Search costs one free-tier credit per request. Without the server, a key, or available credits, recommendations fall back to public Wikibooks/Wikiversity search.

### 3. (Optional) Run the Napkin Proxy for Firefox Dev

Firefox enforces strict origin constraints on extension requests (`moz-extension://`). If using Napkin AI in Firefox:

```bash
npm run napkin-proxy
```

---

## 💻 Build Commands

| Command | Description |
|---|---|
| `npm run build:chrome` | Compiles production bundle for Google Chrome into `dist/chrome/` |
| `npm run build:firefox` | Compiles production bundle for Mozilla Firefox into `dist/firefox/` |
| `npm run build` | Compiles both Chrome and Firefox targets sequentially |
| `npm run dev:chrome` | Starts Vite development server with Hot Module Reloading for Chrome |
| `npm run dev:firefox` | Starts Vite development server with Hot Module Reloading for Firefox |
| `npm test` | Runs the full Vitest unit test suite (35+ unit tests across all layers) |

---

## 🌐 Loading the Extension in Your Browser

### Google Chrome (or Brave / Edge / Chromium)
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `dist/chrome` folder inside your MindEase project directory.

### Mozilla Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `dist/firefox/manifest.json` (or any file inside `dist/firefox/`).

---

## 📖 How to Use MindEase

1. **Onboarding questionnaire:** Choose a learning language, reading length and pace, format, and whether to start narrated reading automatically after accepting an adaptation. Optionally describe support needs in your own words; that description is sent to the configured AI service to propose allowlisted presentation hints, not to diagnose a condition. The original description is saved even when the AI service is unavailable.

2. **Browsing and studying:**
   - During an active session, MindEase checks candidate pages' extracted content with the configured LLM before automatically treating them as study tabs. If classification is unavailable, it does not automatically include that page.
   - Before adapting a source, choose structured or visual explanation. **Use my preferred learning language** is selected by default; uncheck it to keep the document's language. Original source sections remain accessible.
   - The reading panel applies font size and motion preferences, with A−/A+ controls. Narration reads rendered text (not Markdown markers); automatic narration requires an explicit onboarding choice. Controls pause or stop speech.
   - Related learning links use server-side Tavily web search across websites, with live Wikibooks/Wikiversity results as a fallback. Visual search favors illustrated explanations when per-page image metadata is available; inspect each result to confirm its quality. No model-invented URLs are shown.

3. **Highlighting & Note-Taking:**
   - Highlight any text on the page to save it as a study note.
   - Notes are aggregated across all visited tabs in your study session.

4. **Right-Click Context Tools:**
   - **Explain with MindEase:** Highlight complex text, right-click, and get a concise tutor breakdown.
   - **Extract Text with MindEase:** Right-click diagrams or slides to perform OCR text extraction.
   - **Capture & Explain:** Take a screenshot of formulas or graphs to crop and analyze them.

5. **Popup Controls & Overrides:**
   - Click the MindEase extension icon to check active session status, adjust manual parameter overrides, or view live Q-table learning values.

6. **Session dashboard and complete review:**
   - End your study session from the popup or reading panel. The dashboard shows source-grounded topics, notes, study cards, and gaps, plus a complete printable review with source material and original links.
   - Click **Open complete review / Save as PDF**, then choose **Print / Save as PDF** and the browser's **Save as PDF** destination. PDF creation is browser-driven so multilingual text and multi-page lessons remain legible.
   - If session-end learning actually changes presentation parameters, the dashboard shows the observed interaction counts and the specific adjustment planned for next session. No notice appears for no-change sessions.
   - The complete source-text review is available for the latest completed session while its saved chunks remain in local storage; historical session entries retain metadata, not full lesson text.
   - Optional support presets are starting points, not diagnoses. User-selected format, length, audio choice, and font override take priority.

Accessibility choices follow the [W3C cognitive accessibility guidance](https://www.w3.org/TR/coga-usable/), [WCAG text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html), and [WCAG audio control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html). Different people with the same label benefit from different settings; audio is never enabled solely by a condition label.

---

## 🧪 Testing & Verification

MindEase includes unit test suites verifying all layer contracts:

```bash
npm test
```

Test suites include:
- `src/layer1/layer1.test.ts`: Annotation parsing, tag extraction, definition flags, formula wrapping.
- `src/layer2/layer2.test.ts`: 81-state discretization, Q-learning updates, user overrides, explainability generator.
- `src/layer3/layer3.test.ts`: Engagement score boundaries, gap severity sorting, flashcard generation, connection detection.
- `src/session/session.test.ts`: Workspace lifecycle state transitions, focus time tracking, per-tab highlights.

---

## 📚 Technical Documentation

For the comprehensive technical specification, mathematical models, message passing contracts, and state transition details, refer to:
👉 **[`TECHNICAL_REFERENCE.md`](TECHNICAL_REFERENCE.md)**

---

## 📄 License

MIT License. Built with purpose for learners who think differently.
