# MindEase — Agent Instructions

Browser extension (MV3) for neurodiverse learners. Chrome + Firefox builds.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev:chrome` | Vite dev server + HMR (Chrome) |
| `npm run dev:firefox` | Vite dev server + HMR (Firefox) |
| `npm run build:chrome` | Prod build → `dist/chrome/` |
| `npm run build:firefox` | Prod build → `dist/firefox/` |
| `npm run build` | Both Chrome + Firefox sequentially |
| `npm run test` | `vitest run` (node env, not jsdom) |
| `npm run napkin-proxy` | Dev proxy on `:3001` — Napkin AI blocks `moz-extension://` origins |

No lint, format, or typecheck scripts. `tsc --noEmit` works manually. `strict: true`. No CI (no `.github/`).

## Architecture

**5-entrypoint extension** — background service worker, content script, popup, onboarding, dashboard. Cross-layer communication via `browser.runtime.sendMessage` / `browser.runtime.onMessage` (24+ typed message types in `src/types/index.ts`).

| Layer | Dir | Role |
|---|---|---|
| **L1** | `src/layer1/` | Content transformation (Mistral AI + Napkin visuals + Flux/HF images + OCR.space) |
| **L2** | `src/layer2/` | Q-learning RL agent (81 states, 9 actions), cognitive profiling, onboarding |
| **L3** | `src/session/` + `src/layer3/` | Session state machine + engagement tracking, gap analysis, study cards |
| **Background** | `src/background/` | Message router, session lifecycle, context menus |
| **Content script** | `src/content/` | Behavior tracking, overlay injection, TTS, OCR popup |

## Content Adaptation (L1)

**Annotation-only**: LLM inserts structural tags around existing text — never rewrites. Tags: `[CHUNK]`, `[CONCEPT:]`, `[DEF:]`, `[EXAMPLE]`/`[EXAMPLE_END]`, `[FORMULA]`/`[/FORMULA]`, `[SUMMARY:]`. Parser `parseAnnotatedContent()` extracts `ContentChunk` objects.

**Progressive loading**: Batches of 3 chunks, 150ms delay. First batch `append: false` → `injectOverlay()`, rest `append: true` → `appendToOverlay()`. Final batch `done: true`.

**Adaptive rendering** in `injectOverlay()`:
- `learningApproach=example-first` → examples before theory
- `secondLanguageLearner=true` → `[DEF:]` as interactive tooltips
- `readingPace` → font-size via CSS class
- `infoDensity=concise` → collapse example chunks (toggle)
- `[FORMULA]` → KaTeX (inline + block)

## Gotchas

- **`vite-plugin-web-extension`** is a **dependency** (not devDep) — required at build time.
- **webextension-polyfill mock** (`src/__mocks__/`) aliased during `VITEST` via vite config.
- **Only L3 has tests** (`src/layer3/layer3.test.ts`, 21 tests). No tests for L1, L2, popup, dashboard, SessionManager.
- **Napkin proxy** needed for Firefox dev: `moz-extension://` origins blocked. Run `npm run napkin-proxy` separately.
- **Mistral AI** is the current L1 provider (`api.mistral.ai`). Ignore stale Gemini references in comments (e.g., `background/index.ts:7`).
- **Dynamic imports** in `src/background/index.ts` — `setupLayer2Listeners` static at top, but `handleBehaviorSignal` uses `import("@/layer2")` inside callback to break circular deps (background ↔ L2 ↔ SessionManager).
- **Theme CSS** (`src/styles/theme.css`) loaded only by dashboard (`dashboard.ts`). Onboarding has inline CSS (`onboarding.css`). Popup has inline CSS.
- **Icons** — `src/utils/icons.ts` returns emoji strings. `lucide-react` used in onboarding. `lucide` (base) unused.
- **KaTeX** — `katex` package bundled, used in `src/utils/latex.ts`. CSS loaded from CDN in content script and dashboard.
- **`.env` variables**: `VITE_MISTRAL_API_KEY`, `VITE_NAPKIN_API_KEY`, `VITE_HF_TOKEN`, `VITE_OCR_SPACE_API_KEY`.
- **`condition` field** (`CognitiveNeed`): onboarding collects dyslexia/ADHD/autism/multilingual. Stored in profile. **RL agent never acts on it** — decisions purely from behavior signals via Q-learning.
- **`uuid` package** (`v14`) used in 6 files. But `onboarding.tsx` and `profileManager.ts` each define own `Math.random`-based `generateUUID()`.
- **Firefox build** switches `background.service_worker` → `background.scripts` + adds `browser_specific_settings.gecko`. Strips `sidePanel` and `downloads` permissions.
- **`sidePanel` permission** declared in manifest but unused in code.
- **Onboarding file** (`onboarding.tsx`) included via `additionalInputs` in vite config — not auto-discovered by `vite-plugin-web-extension`.
- **Puter.js TTS** replaces Web Speech API — no API keys, free. Injected via `<script>` tag in page main world; content ↔ main world via `postMessage` (`src/content/puterTts.ts`).
- **OCR** via OCR.space — right-click context menu on images, result in floating popup (`src/layer1/ocrClient.ts`).

## Conventions

- Named exports only, no default exports
- `@/` alias → `src/`
- Async/await for storage and API calls
- `.catch(() => {})` for fire-and-forget message sends
- Arrow functions, `PascalCase` types/classes, `camelCase` everything else

## Key Files

- `src/types/index.ts` — all shared types, message types, storage keys
- `src/background/index.ts` — message router, session lifecycle, context menus
- `src/content/index.ts` — content script entry, overlay, TTS, OCR popup, formatPreference tabs
- `src/content/puterTts.ts` — Puter.js TTS bridge
- `src/layer1/ocrClient.ts` — OCR.space client
- `src/layer1/napkinClient.ts` — Napkin AI visual generation
- `src/layer1/visualOrchestrator.ts` — visual orchestration (Napkin/Flux)
- `src/session/SessionManager.ts` — multi-tab session state machine
- `src/session/dashboard/dashboard.tsx` — React dashboard (10 sections, visual lightbox)
- `src/layer2/rlAgent.ts` — Q-learning agent (81 states × 9 actions)
- `src/layer2/profileManager.ts` — profile creation + RL updates
- `src/layer3/*.ts` — sessionTracker, gapAnalyzer, connectionDetector, studyCardGenerator
- `src/styles/theme.css` — shared purple palette design tokens
- `src/utils/latex.ts` — KaTeX rendering utility
- `src/utils/icons.ts` — lucide SVG helper for non-React code