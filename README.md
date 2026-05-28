# MindEase — Learn the Way Your Brain Was Meant To

> AI-native browser extension for neurodiverse learners  
> Team: The Architects | ENSIT, Tunisia | GCD4F 2026 — AI for Education

---

## Team & Layer Ownership

| Layer | Owner | Responsibility |
|---|---|---|
| Layer 1 — Real-Time Content Transformation | Rayhane | PDF/website/video/lecture interception & restructuring |
| Layer 2 — Adaptive Cognitive Profiling | Taha | RL agent, onboarding assessment, cognitive profile |
| Layer 3 — Session Memory & Synthesis | Eya | Session tracker, gap analysis, study cards, knowledge artifact |

---

## Tech Stack

- **Language**: TypeScript
- **Build tool**: Vite + `vite-plugin-web-extension`
- **Target**: Chrome (MV3) + Firefox (MV3)
- **Package manager**: npm

---

## Getting Started

```bash
# Install dependencies
npm install

# Development (Chrome)
npm run dev:chrome

# Development (Firefox)
npm run dev:firefox

# Production build
npm run build
```

---

## Project Structure

```
src/
├── types/          # Shared TypeScript interfaces (read before touching any layer)
├── background/     # Service worker — session lifecycle & message routing
├── content/        # Content script — runs on every page
├── popup/          # Extension popup panel
├── layer1/         # Rayhane — content transformation
├── layer2/         # Taha    — cognitive profiling
└── layer3/         # Eya     — session memory & synthesis
```

---

## Branching Convention

```
main              ← stable, reviewed code only
feature/layer1-*  ← Rayhane's work
feature/layer2-*  ← Taha's work
feature/layer3-*  ← Eya's work
```

---

## Inter-Layer Contract

All inter-layer communication uses typed messages defined in `src/types/index.ts`.  
**Do not change shared types without notifying the full team.**
