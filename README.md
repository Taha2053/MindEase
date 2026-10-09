# MindEase

Chrome and Firefox MV3 extension for adaptive reading, session review, diagrams, and source-grounded Manim videos.

## Run

```sh
npm install
uv sync --directory server --extra dev
npm run server
npm run dev:chrome
# Or npm run dev:firefox
```

The authoritative Python application is `server/`. `uv` selects `server/.venv`; activating the cloned project's environment is unnecessary. The historical checkout has been moved outside this project to `../MindEase-arXivisual-backup/`, preserving its original configuration, database, and generated media. That backup is not imported or required by the application. Native Manim requirements include FFmpeg, Cairo/Pango, and LaTeX/dvisvgm for formulas. See `server/README.md` for provider and rendering configuration.

```sh
npm run build         # dist/chrome and dist/firefox
npm test
npx tsc --noEmit
npm run server:test
npm run config:check  # configuration presence, not credential authentication
```

Load the generated manifest as an unpacked Chrome extension or a temporary Firefox add-on.

## Firefox Add-ons source build

The AMO submission is built from unmodified TypeScript, React, HTML, and CSS
sources in this repository. The Python backend is not part of the extension
bundle and is not required for this build.

Build environment:

- Linux x86-64
- Node.js 24.12.0 (install from <https://nodejs.org/>)
- npm 11.6.2 (included with the specified Node.js installation)
- Info-ZIP `zip` 3.0 (`sudo apt-get install zip` on Debian/Ubuntu)

From a clean source checkout, run:

```sh
./build-firefox-amo.sh
```

The script uses `npm ci` with `package-lock.json`, configures the public
MindEase backend URL, builds the Firefox extension, and creates the submitted
archive at `dist/mindease-firefox.zip`. It deliberately removes provider and
cloud credentials from the build environment; no `.env` file or secret is
required. The unpacked build is available at `dist/firefox/`.

## Configuration

Extension settings accept a MindEase server URL and personal DeepSeek, Napkin, and OCR.space keys. Root `.env` supplies public build configuration (`VITE_PREMIUM_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Provider secrets should normally remain in `server/.env`, not distributed Vite bundles. The server loads its own configuration using an absolute path and then root configuration without overriding existing values.

DeepSeek plans reading adaptations and diagram structure. Napkin produces diagrams; the integrated Manim pipeline produces videos. Mistral and Flux are no longer reading/visual providers. Existing optional video-provider and speech integrations remain available. Remote servers receiving personal Napkin keys must use HTTPS; local loopback development is allowed.

## Reading and sessions

The popup lists all open browser tabs at all times, including before a study session starts and prior to completing onboarding. Tabs receive content-based learning or non-learning classifications (Google Classroom and Google Sheets are recognized automatically). Tab classification operates as a suggestion and is completely decoupled from adaptation inclusion: users independently toggle each tab's checkbox to include or exclude it from adaptation during sessions. When a session is active, a manual "Classify unclassified tabs" button is available in the popup to process remaining unclassified tabs in the background.

Automatic tab-name classification batches titles and URLs through DeepSeek. Missing, invalid, or unavailable model results remain pending rather than defaulting to learning. Starting a content session preserves an existing classification; manual inclusion overrides remain independent. Late classification results apply only to the same tab URL and session.

Content extraction preserves document structure, headings, lists, code, tables, and formula source (`[FORMULA]` tags) while stripping navigation, promotions, and unrelated suggestions. Scientific sections like derivations and notes remain intact.

Formulas use bundled KaTeX styles in both extension documents and the isolated content-script shadow root. The accessibility MathML remains available to assistive technology without appearing as a second visible equation. Display formulas have a padded border; inline formulas receive a compact outline.

Remote PDFs can be opened directly through the popup's "Read PDF" button or the dashboard reader route (`#reader?source=...&tab=ID`). The reader requires explicit user consent before sending the URL or text to the configured MindEase server, verifies the source tab remains open and non-private, and saves adapted sections directly into the active session. Browser-internal PDF viewers that block content script execution display an honest notice guiding the learner to use the reader.

Video lessons on YouTube or standard HTML5 players (including Vimeo) inspect subtitle and caption text tracks to generate synchronized narration chunk overlays. If dialogue tracks are disabled or unavailable, an informative notice is displayed explaining that captions must be enabled on the player.

Related website recommendations extract multiple core concepts from adapted sections, query external resources with domain deduplication and visual-preference ranking, and fall back to public educational references (Wikibooks/Wikiversity) matching verified topic words when search services are unreachable.

Adapted prose is instructed to be concise, retaining meaning and formulas. Shortening is prompt-directed rather than truncating generated text. Source blocks remain available alongside adaptations; omitted or changed formulas cause rejection and correction. If both generation attempts fail validation, the original source is shown instead. Diagram placeholders report pending, completed, and failed generation.

Learning-profile updates occur at session end. Source chunks are saved progressively. A failed archive save retains the workspace and chunks for retry, including across a background-worker restart. Account switching is blocked while a session or failed archive remains unfinished.

## Accounts and storage

Device and account snapshots share IndexedDB but have separate records. Device profiles have a stable installation ID. Authentication changes propagate through extension storage to active surfaces; switching accounts restores that learner's data rather than carrying over the previous account's history.

Local archives remain readable when cloud requests or token refresh fail. Cloud-designated archives retain pending/error status and offer retry. Archives belong to the account captured when saved. Choosing cloud storage requires authentication; cancelled authentication falls back to local storage.

**Required Supabase deployment:** run `supabase/schema.sql` for a new project. Existing installations must apply migrations through `supabase/migrations/004_atomic_session_history.sql`. Migration 004 adds the authenticated `sync_session_history` RPC and deletion tombstones. Its row lock merges concurrent device uploads without losing distinct sessions; tombstones prevent stale uploads from resurrecting deleted history. RLS limits access to the authenticated owner. Repository changes do not deploy migrations to your remote project automatically.

## Review and videos

Dashboard lesson archives group saved content, topics, review cards, diagrams, and video references. Reveal answers in the Review tab. Export Markdown summaries, Anki-compatible TSV cards with MathJax formulas, or archive JSON. JSON contains diagram data and video URLs, **not embedded video files**: preserve the server media directory or configured object storage for later playback.

Video Studio is embedded in dashboard navigation. The reading sidebar opens the dashboard's video route with the source URL prefilled. Job identifiers and source drafts survive navigation/reloads so polling can resume. Saved videos retain their original save time and session attribution; late media completions are appended to existing lesson archives.

The onboarding surface uses an ink-landscape backdrop, glass panels, jade/porcelain colors, and reduced-motion-aware background animation.

## Verification boundaries

Local automated regression suites cover extraction, formulas, archive failures, account isolation, exports, tracking overrides, and backend behavior. An isolated PostgreSQL smoke exercised concurrent history merging, racing deletion, RLS isolation, and anonymous-RPC rejection. The integrated renderer produced an actual H.264 clip with a LaTeX formula. These checks do not establish remote Supabase deployment, authenticate paid provider credentials, or certify generated educational accuracy. Browser visual acceptance remains a separate check.
