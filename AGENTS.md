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
| `npm run test` | `vitest run` (node env) |
| `npm run napkin-proxy` | Dev proxy on `:3001` — Napkin AI blocks `moz-extension://` origins |

No lint, format, or typecheck scripts. `tsc --noEmit` works manually. `strict: true`. No CI (no `.github/`).

## Content Adaptation Architecture

L1 uses an **annotation-only** approach: the LLM never rewrites the original text. It inserts structural tags (`[CHUNK]`, `[CONCEPT:]`, `[DEF:]`, `[EXAMPLE]`/`[EXAMPLE_END]`, `[FORMULA]`/`[/FORMULA]`, `[SUMMARY:]`) around existing content. The parser `parseAnnotatedContent()` strips code fences and extracts metadata into `ContentChunk` objects (fields: `conceptTags`, `summary`, `isExample`, `hasDefinitions`). All adaptation happens at the rendering layer in the content script.

**Progressive loading**: Background sends LLM results in batches of 3 chunks with a 150ms inter-batch delay. First batch uses `append: false` → `injectOverlay()`, subsequent batches use `append: true` → `appendToOverlay()`. Final batch sets `done: true` to hide the loading marker.

**Adaptive rendering** in `injectOverlay()`:
- `learningApproach=example-first` reorders chunks: examples before theory
- `secondLanguageLearner=true` highlights `[DEF:]` terms as interactive tooltips
- `readingPace` controls font-size via CSS class
- `infoDensity=concise` collapses example chunks (hidden behind toggle)
- `[FORMULA]` rendered with KaTeX in both inline and block mode

## Architecture

**5-entrypoint extension** — background service worker, content script, popup, onboarding, dashboard. Cross-layer communication via `browser.runtime.sendMessage` / `browser.runtime.onMessage` (24 typed message types in `src/types/index.ts`).

| Layer | Dir | Role |
|---|---|---|
| **L1** | `src/layer1/` | Content transformation (Mistral AI + Napkin visuals + Flux/HF images) |
| **L2** | `src/layer2/` | Q-learning RL agent (81 states, 9 actions), cognitive profiling, onboarding |
| **L3** | `src/session/` + `src/layer3/` | Session state machine + engagement tracking, gap analysis, study cards |
| **Background** | `src/background/` | Message router, session lifecycle |
| **Content script** | `src/content/` | Behavior tracking, overlay injection |

## Gotchas

- **`vite-plugin-web-extension`** is a **dependency** (not devDep) — required at build time.
- **webextension-polyfill mock** (`src/__mocks__/`) is aliased during `VITEST` via vite config. Tests run under `node` env, not jsdom.
- **Only L3 has tests** (`src/layer3/layer3.test.ts`, 21 tests). No tests for L1, L2, popup, dashboard, or SessionManager.
- **Napkin proxy** needed for Firefox dev: `moz-extension://` origins are blocked. Run `npm run napkin-proxy` separately.
- **Mistral AI** is the current L1 provider (`api.mistral.ai`). Ignore stale Gemini references in comments.
- **Dynamic imports** in `src/background/index.ts` — `setupLayer2Listeners` imported statically at top, but `handleBehaviorSignal` uses `import("@/layer2")` inside a callback to break circular deps between background ↔ L2 ↔ SessionManager.
- **Theme CSS** (`src/styles/theme.css`) loaded only by dashboard (`dashboard.ts`). Onboarding has its own CSS (inline theme variables in `onboarding.css`). Popup has inline CSS.
- **Icons** — `src/utils/icons.ts` returns emoji strings. `lucide-react` IS used in onboarding (Brain, Feather, Rainbow, etc.). `lucide` (base, non-React) is unused.
- **KaTeX** — `katex` package bundled and used in `src/utils/latex.ts` for server-side rendering. CSS loaded from CDN in content script and dashboard.
- **`.env` variables**: `VITE_MISTRAL_API_KEY`, `VITE_NAPKIN_API_KEY`, `VITE_HF_TOKEN`.
- **`condition` field** (`CognitiveNeed`): onboarding collects dyslexia/ADHD/autism AND stores them in the profile. `profileManager.createProfile()` also passes condition through. The RL agent never acts on the condition — decisions are purely based on behavior signals via Q-learning.
- **`uuid` package** (`v14`) is used in 6 files (background, layer1, layer3, SessionManager). But `onboarding.tsx` and `profileManager.ts` each define their own `Math.random`-based `generateUUID()`.
- **Firefox build** switches `background.service_worker` → `background.scripts` + adds `browser_specific_settings.gecko`. Also strips `sidePanel` and `downloads` permissions.
- **`sidePanel` permission** declared in manifest but unused in code.
- **README TypeScript badge** says 5.4; `package.json` has `^6.0.3`.
- **Onboarding file** (`onboarding.tsx`) is included via `additionalInputs` in vite config — it's not auto-discovered by `vite-plugin-web-extension`.

## Conventions

- Named exports only, no default exports
- `@/` alias → `src/`
- Async/await for storage and API calls
- `.catch(() => {})` for fire-and-forget message sends
- Arrow functions, `PascalCase` types/classes, `camelCase` everything else

## Anchored Summary

### Goal
Overhaul the extension's visual identity to match the onboarding/popup purple theme across all surfaces, and deliver a premium editorial-style dashboard redesign.

### Done
- `src/utils/icons.ts`: replaced emoji map with individual lucide ESM imports; `iconHTML()` returns 18px inline SVG strings.
- `src/styles/theme.css`: all dark/light color variables replaced with onboarding purple palette.
- `src/content/index.ts` `OVERLAY_CSS`: theme variables updated to onboarding palette; added `--success`/`--warning` vars.
- `src/content/sidebarManager.ts`: reopen button gradient and pulse animation colour updated to purple palette.
- `src/session/dashboard/dashboard.ts` (vanilla TS) → `dashboard.tsx` (React TSX with lucide-react). All sections are React components; canvas focus timeline preserved via refs.
- `src/session/dashboard/dashboard.html`: slimmed to `<div id="root">` mounting the React tree.
- `src/content/discoveryPrompt.ts`: new module — floating card "Want MindEase for this page?" with Enable / Not now buttons. Auto-dismisses after 10s, stores dismissed domains in storage.
- `src/content/index.ts` IIFE: when `shouldActivate()` returns false, calls `showDiscoveryPrompt()`. On Enable: sets `_extensionActive = true` and sends `SESSION_START` + `triggerContentTransformation("website")`.
- `src/content/index.ts` `shouldActivate()`: added `promptOnlyHosts` list (asset CDNs, search engines) that return false so the discovery prompt appears instead of auto-activation.
- Overlay footer: added "Full view" button that opens `dashboard.html` in a new tab.
- `src/lucide-icons.d.ts`: wildcard declaration for `lucide/dist/esm/icons/*.mjs` imports.
- **Dashboard redesign**: `dashboard.css` + `dashboard.tsx` fully rewritten — fixed left sidebar (200px, brand + nav items + footer actions), sticky top header, responsive multi-column card grid with 18px border-radius. All sections use theme variables. IntersectionObserver sidebar active-state tracking. Staggered fade-in animation on cards. Build and tests pass.

### Key Decisions
- `iconHTML()` kept as drop-in for non-React surfaces (content script); React surfaces import lucide-react directly.
- Discovery prompt uses inline `STYLES` string to keep CSS small and avoid host page interference.
- `promptOnly` checked by hostname for CDNs and by URL regex for search engines.
- "Full view" button uses `window.open` rather than background message.
- Dashboard sidebar nav uses `IntersectionObserver` for active state tracking (no hash routing needed).

### Relevant Files
- `src/styles/theme.css`: shared design tokens — onboarding purple palette.
- `src/content/index.ts`: content script — OVERLAY_CSS, shouldActivate, IIFE, overlay footer.
- `src/content/discoveryPrompt.ts`: discovery prompt module — UI, dismiss storage.
- `src/content/sidebarManager.ts`: reopen button styles — purple gradient/pulse.
- `src/utils/icons.ts`: lucide SVG helper for non-React code.
- `src/session/dashboard/dashboard.tsx`: React dashboard — all 10 sections.
- `src/session/dashboard/dashboard.css`: editorial layout with sidebar, card grid, animations.
- `src/session/dashboard/dashboard.html`: entry point — mounts React root.
- `src/lucide-icons.d.ts`: type declaration for lucide ESM icon imports.
