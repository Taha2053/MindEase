# MindEase Implementation Plan

This plan implements the approved product direction in small, reversible slices. Existing server work and the nested `arXivisual` checkout are outside this plan unless a later phase explicitly includes them.

## 1. Source-Grounded Article Vertical Slice

- [x] Define stable source-block identifiers and immutable source text.
- [x] Extract article text without deleting citations and retain stable source order.
- [x] Require model annotations to reference source block IDs; reject missing, duplicate, reordered, or unknown references.
- [x] Validate verbatim source text across the complete transformation.
- [x] Reject altered, missing, duplicated, empty, or truncated transformations.
- [x] Escape source/provider text before applying supported presentation markup.
- [x] Add focused unit tests for extraction, validation, parsing, and safe source rendering.

**Acceptance:** Every displayed source block maps to one extracted block; altered, missing, duplicated, unknown, or reordered blocks are rejected; generated summaries are labelled separately; tests, TypeScript, and both browser builds pass.

Current implementation sends blocks in batches for JSON metadata only and renders source text directly with HTML escaping. Summaries are labelled AI explanations. Main-region extraction excludes navigation and extension UI; extraction quality and DOM anchoring still need browser verification. Formula text is preserved verbatim; rich formula rendering for the new contract remains pending. The legacy annotation parser remains for compatibility.

Theme: light background `#F7E6CA` with sapphire `#0F52BA`; dark background `#010736` with cream `#F7E6CA` text/accents. Rendered contrast and visual checks remain pending.

## 2. Adaptation Recommendation and Consent

Progress: the background validates explicit adaptation choices before starting work; replacement prompts cancel their pending requests, and content scripts check acknowledgement. Public Supabase configuration has been moved to the root environment, duplicate assignments normalized, and a value-free `npm run config:check` command added. Provider authentication is not yet verified.

- [x] Define text/visual bundles and deterministic initial ranking from declared format preference.
- [x] Show a keyboard-accessible adaptation chooser before provider calls.
- [x] Support accept-one, adapt-all, alternative, and keep-original outcomes.
- [ ] Persist only explicitly accepted preferences.

**Acceptance:** No page content leaves the browser until the learner accepts an adaptation; declining twice leaves the page unchanged.

## 3. Session Reliability and Feedback

- [x] Consolidate session ownership and restore state after worker suspension.
- [ ] Reuse source-block IDs in behavior events and Layer 3 artifacts.
- [x] Clear session-scoped data at the correct lifecycle boundaries.
- [x] Add post-session helpfulness, confidence, preference, and optional comments.
- [x] Rename inferred gaps to “content that may need review.”

**Acceptance:** A multi-tab session survives worker restart without resets or cross-session data; feedback is reviewable and deletable.

## 4. Explainable Personalization

- [x] Make explicit preferences the deterministic recommendation inputs.
- [ ] Replace live Q-learning decisions with a constrained contextual-bandit interface.
- [x] Start with a deterministic policy while collecting explicit session feedback.
- [x] Remove Q-learning from live passive-event decisions; retain its implementation for research tests.
- [x] Build a “Why MindEase suggested this” view with edit controls and uncertainty disclosure.

**Acceptance:** Recommendations cite real inputs, disclose uncertainty, never claim diagnosis, and never override manual controls.

## 5. Privacy, Permissions, and Providers

- [x] Exclude sensitive and browser-internal contexts locally.
- [ ] Minimize required permissions and request site access when feasible.
- [x] Add provider disclosure plus export/delete controls.
- [x] Remove the Flux integration.
- [x] Route hosted provider credentials through an authenticated gateway in production.
- [x] Keep browser TTS as fallback; add Azure TTS only through the backend.

**Acceptance:** No hosted credential is bundled in the extension; provider transfers require informed consent; all retained learner data can be inspected and deleted.

## 6. PDF, Video, Diagram, and Manim Beta

- [ ] Parse text PDFs with page provenance and OCR fallback.
- [ ] Require verified captions/transcripts for video adaptation.
- [ ] Generate diagrams only when accepted and include a text equivalent.
- [ ] Execute generated Manim code in an isolated, resource-limited worker.
- [ ] Add prepared fallback assets for the competition demo.

**Acceptance:** Unsupported media fails clearly without fabricated source content; optional media failures do not interrupt reading.

## 7. Product Verification and Release Preparation

Latest progress: recommendation alternatives and factual reasons are connected to the chooser. Onboarding and dashboard restore the saved theme. Sensitive-page exclusions run locally and in the transformation router; automatic remote classification is removed from activation. Session deletion removes its feedback. A regression test verifies passive events cannot invoke the Q-learning policy or change the profile. Onboarding copy and layout are revised; session feedback supports local save/edit/delete. Azure Speech is available as an explicit premium choice through the backend with browser speech fallback. Comprehension checks, rendered browser verification, hosted authentication, and validated learning outcomes remain outstanding.

- [ ] Add Chrome and Firefox end-to-end smoke coverage.
- [ ] Test keyboard, screen-reader semantics, zoom/reflow, contrast, and reduced motion.
- [ ] Measure provider latency, failure rate, request size, and cost.
- [ ] Update product claims, setup, privacy, deployment, and demo documentation.

**Acceptance:** Automated checks pass, both browsers are manually verified, and every competition claim has a demonstrable evidence path.

## 8. Accounts and Optional Synchronization

- [x] Preserve a no-account, local-only mode.
- [x] Add Supabase email/password sign-in while preserving no-account mode.
- [x] Separate profile-sync consent from session-history consent.
- [x] Synchronize opted-in profile, history, and session feedback with RLS ownership policies.
- [x] Exclude access tokens and provider keys from learner-data exports.
- [x] Require Supabase bearer authentication for production premium requests.
- [ ] Apply the SQL migration in the target Supabase project.
- [ ] Test account confirmation, OAuth, token refresh, RLS, offline recovery, and cloud deletion against the deployed project.

**Acceptance:** Local mode never uploads profile/history; each cloud category requires explicit opt-in; one account cannot read or change another account's data; production premium endpoints reject missing or expired sessions.
