<div align="center">

# 🧠 MindEase
### *Learn the Way Your Brain Was Meant To*

**AI-native browser extension for neurodiverse learners**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.2-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![Firefox](https://img.shields.io/badge/Firefox-MV3-FF7139?style=flat-square&logo=firefox)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

*9th Global Competition on Design for Futures (GCD4F) — AI for Education Track*  
*Team: The Architects | ENSIT, Tunis University, Tunisia*

</div>

---

## What is MindEase?

Education was built for the average brain. **1 in 5 students doesn't have one.**

MindEase is a browser extension that intercepts educational content in real time — PDFs, websites, videos, live lectures — and restructures it to match each learner's individual cognitive profile. No manual setup. No clinical diagnosis required. It works silently in the background, adapting to the way each brain actually processes information.

It is not an accessibility patch. It is a fundamental rethinking of how educational content reaches the learner.

---

## How It Works

MindEase operates through three interconnected layers:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Real-Time Content Transformation                 │
│  Intercepts PDFs, websites, videos and live lectures.       │
│  Restructures content on the fly per the learner's profile. │
└─────────────────────────────┬───────────────────────────────┘
                              │ cognitive profile
┌─────────────────────────────▼───────────────────────────────┐
│  Layer 2 — Adaptive Cognitive Profiling                     │
│  A reinforcement-learning agent builds and continuously     │
│  refines a model of how each specific brain learns.         │
└─────────────────────────────┬───────────────────────────────┘
                              │ behavioral signals
┌─────────────────────────────▼───────────────────────────────┐
│  Layer 3 — Session Memory & Synthesis                       │
│  Tracks engagement, detects gaps, finds cross-source        │
│  connections, and generates a personalized knowledge        │
│  artifact at the end of every session.                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Features

- **Real-time adaptation** — content restructured before it hits the screen
- **Cognitive profiling** — RL agent learns from highlights, pauses, re-reads, skips
- **Session synthesis** — personalized study cards and knowledge artifact after every session
- **Gap detection** — flags what the brain skipped or skimmed for review
- **Cross-source linking** — connects concepts across PDFs, videos, and websites
- **Privacy-first** — all processing and storage is local; no data leaves the device
- **Zero setup** — no diagnosis, no manual configuration required

---

## Tech Stack

| | |
|---|---|
| Language | TypeScript |
| Build tool | Vite + `vite-plugin-web-extension` |
| Browsers | Chrome MV3, Firefox MV3 |
| Storage | `chrome.storage.local` (fully local) |
| Package manager | npm |

---

## Getting Started

```bash
# Clone the repository
git clone https://github.com/Taha2053/MindEase.git
cd MindEase

# Install dependencies
npm install

# Development build (Chrome)
npm run dev:chrome

# Development build (Firefox)
npm run dev:firefox

# Production build (both browsers)
npm run build
```

### Loading the extension locally

**Chrome:**
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `dist/chrome`

**Firefox:**
1. Go to `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select any file inside `dist/firefox`

---

## Project Structure

```
src/
├── types/          # Shared TypeScript interfaces — read before editing any layer
├── background/     # Service worker — session lifecycle & message routing
├── content/        # Content script — runs on every visited page
├── popup/          # Extension popup panel
├── layer1/         # Real-Time Content Transformation
├── layer2/         # Adaptive Cognitive Profiling
└── layer3/         # Session Memory & Synthesis
```

---

## Contributing

```
main                ← stable, reviewed code only
feature/layer1-*    ← content transformation work
feature/layer2-*    ← cognitive profiling work
feature/layer3-*    ← session memory & synthesis work
```

All inter-layer communication uses typed messages defined in `src/types/index.ts`.  
**Do not modify shared types without a team discussion.**

---

<div align="center">
  <sub>Built with purpose for learners who think differently.</sub>
</div>