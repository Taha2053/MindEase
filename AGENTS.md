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

No lint, format, or typecheck scripts exist. `tsc --noEmit` works manually. `strict: true`. No CI workflows (no `.github/`).

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
- **Dynamic imports** in `src/background/index.ts` (`import("@/layer2")`) avoid circular deps between background ↔ L2 ↔ SessionManager.
- **Theme CSS** (`src/styles/theme.css`) is loaded only by dashboard (`dashboard.ts`). Onboarding has its own CSS (inline theme variables in `onboarding.css`). Popup has inline CSS.
- **Icons** are emoji-based (`src/utils/icons.ts`), not SVG. `lucide` package in deps is unused.
- **KaTeX** loaded from CDN in content script and dashboard (not bundled).
- **`.env` variables**: `VITE_MISTRAL_API_KEY`, `VITE_NAPKIN_API_KEY`, `VITE_HF_TOKEN`.
- **`condition` field** (`CognitiveNeed`): onboarding collects dyslexia/ADHD/autism but `profileManager.createProfile()` only sets `"multilingual"` or `"none"` based on `secondLanguageLearner`. RL never acts on condition.
- **`uuid` package** exists but `profileManager.ts` and `onboarding.ts` each define their own `Math.random`-based `generateUUID()`.
- **Firefox build** switches `background.service_worker` → `background.scripts` + adds `browser_specific_settings.gecko`.
- **`sidePanel` permission** declared in manifest but unused in code.
- **README TypeScript badge** says 5.4; `package.json` has `^6.0.3`.

## Conventions

- Named exports only, no default exports
- `@/` alias → `src/`
- Async/await for storage and API calls
- `.catch(() => {})` for fire-and-forget message sends
- Arrow functions, `PascalCase` types/classes, `camelCase` everything else
