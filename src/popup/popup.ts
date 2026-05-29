/* ============================================================
   popup/popup.ts — Extension popup panel logic
   Shows Layer 2 cognitive profile + session stats on top,
   Layer 3 knowledge artifact (cards, gaps) below.
   ============================================================ */

import browser from "webextension-polyfill";
import type { FullCognitiveProfile, SessionStats, KnowledgeArtifact, ExtensionMessage } from "@/types";
import { STORAGE_KEYS } from "@/types";

const app = document.getElementById("app")!;

/* ── XSS escape ──────────────────────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "\u2026";
}

/* ── Layer 2: Profile panel ──────────────────────────────────────────────────── */

function renderProfile(profile: FullCognitiveProfile, stats: SessionStats): string {
  const p = profile.transformationParams;
  return `
    <div class="profile-panel">
      <div class="section-title">Cognitive Profile</div>
      <div class="profile-row"><span>Format</span><span>${profile.baseline.formatPreference}</span></div>
      <div class="profile-row"><span>Attention</span><span>${profile.baseline.attentionSpan}</span></div>
      <div class="profile-row"><span>Reading Pace</span><span>${profile.baseline.readingPace}</span></div>
      <div class="profile-row"><span>Concept Anchor</span><span>${profile.baseline.needsConceptAnchor ? "Yes" : "No"}</span></div>
      <div class="profile-row"><span>Second Language</span><span>${profile.baseline.secondLanguageLearner ? "Yes" : "No"}</span></div>
      <div class="profile-row"><span>Sessions</span><span>${profile.rlState.sessionCount}</span></div>
      <div class="profile-row"><span>Engagement Score</span><span>${profile.rlState.totalEngagementScore.toFixed(1)}</span></div>
    </div>

    <div class="profile-panel">
      <div class="section-title">Transformation Params</div>
      <div class="profile-row"><span>Chunk Size</span><span>${p.chunkSize}</span></div>
      <div class="profile-row"><span>Simplify Level</span><span>${p.simplificationLevel}</span></div>
      <div class="profile-row"><span>Caption Speed</span><span>${p.captionSpeed}</span></div>
      <div class="profile-row"><span>Visual Anchors</span><span>${p.useVisualAnchors ? "On" : "Off"}</span></div>
      <div class="profile-row"><span>Summary Freq</span><span>${p.summaryFrequency}</span></div>
    </div>

    <div class="stats">
      <div class="stat-card">
        <div class="num">${stats.totalHighlights}</div>
        <div class="label">Highlights</div>
      </div>
      <div class="stat-card">
        <div class="num">${stats.totalPauses}</div>
        <div class="label">Pauses</div>
      </div>
      <div class="stat-card">
        <div class="num">${stats.totalSkips}</div>
        <div class="label">Skips</div>
      </div>
    </div>

    <div class="btn-group">
      <button id="end-session-btn" class="btn btn-primary">End Session</button>
      <button id="reset-profile-btn" class="btn btn-danger">Reset Profile</button>
    </div>
  `;
}

function renderNoProfile(): string {
  return `
    <div class="waiting">
      <div class="logo">MindEase</div>
      <p class="sub">Complete onboarding to start.</p>
    </div>
  `;
}

/* ── Layer 3: Artifact panel ─────────────────────────────────────────────────── */

function severityClass(severity: string): string {
  switch (severity) {
    case "skipped": return "skipped";
    case "skimmed": return "skimmed";
    case "rushed":  return "rushed";
    default:        return "";
  }
}

function renderCards(artifact: KnowledgeArtifact): string {
  if (artifact.learnedCards.length === 0) {
    return `<p style="font-size:0.8rem;color:#666;">No concepts recorded yet.</p>`;
  }
  return artifact.learnedCards.map((card) => `
    <div class="${card.format === "visual" ? "study-card visual" : "study-card"}">
      <div class="card-header">
        <span class="card-concept">${escapeHtml(card.concept)}</span>
        ${card.reviewFlag ? '<span class="review-badge">Review</span>' : ""}
      </div>
      <div class="${card.format === "spaced-list" ? "card-body spaced" : "card-body"}">${escapeHtml(card.content)}</div>
    </div>
  `).join("");
}

function renderGaps(artifact: KnowledgeArtifact): string {
  if (artifact.gaps.length === 0) {
    return `<p style="font-size:0.8rem;color:#666;">No gaps detected. Nice!</p>`;
  }
  return artifact.gaps.map((gap) => `
    <div class="gap-item">
      <div class="gap-header">
        <span class="gap-concept">${escapeHtml(gap.conceptLabel)}</span>
        <span class="severity-badge ${severityClass(gap.severity)}">${gap.severity}</span>
      </div>
      <div class="gap-text">${escapeHtml(truncate(gap.text, 80))}</div>
    </div>
  `).join("");
}

function renderArtifact(artifact: KnowledgeArtifact): string {
  return `
    <div class="artifact">
      <div class="stats">
        <div class="stat-card">
          <div class="num">${artifact.learnedCards.length}</div>
          <div class="label">Learned</div>
        </div>
        <div class="stat-card">
          <div class="num">${artifact.gaps.length}</div>
          <div class="label">Gaps</div>
        </div>
        <div class="stat-card">
          <div class="num">${artifact.connections.length}</div>
          <div class="label">Connections</div>
        </div>
      </div>
      <div class="section-title">Study Cards</div>
      <div class="scroll-list">${renderCards(artifact)}</div>
      <div class="section-title">Gaps</div>
      <div class="scroll-list">${renderGaps(artifact)}</div>
    </div>
  `;
}

/* ── Actions ─────────────────────────────────────────────────────────────────── */

async function handleEndSession(): Promise<void> {
  await browser.runtime.sendMessage({ type: "SESSION_END" });
}

async function handleResetProfile(): Promise<void> {
  await browser.runtime.sendMessage({ type: "RESET_PROFILE" });
  await browser.tabs.create({
    url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"),
    active: true,
  });
}

/* ── Init ────────────────────────────────────────────────────────────────────── */

async function init(): Promise<void> {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.PROFILE,
    STORAGE_KEYS.SESSION_STATS,
    "latestArtifact",
  ]);

  const profile = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
  const stats = (result[STORAGE_KEYS.SESSION_STATS] as SessionStats | undefined) ?? {
    engagedSections: [],
    skippedSections: [],
    totalHighlights: 0,
    totalPauses: 0,
    totalSkips: 0,
    dominantSignal: "pause" as const,
  };
  const artifact = result["latestArtifact"] as KnowledgeArtifact | undefined;

  let html = profile ? renderProfile(profile, stats) : renderNoProfile();
  if (artifact) html += renderArtifact(artifact);

  app.innerHTML = html;

  document.getElementById("end-session-btn")?.addEventListener("click", handleEndSession);
  document.getElementById("reset-profile-btn")?.addEventListener("click", handleResetProfile);
}

/* ── Live updates from Layer 3 ───────────────────────────────────────────────── */

browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as ExtensionMessage;
  if (msg.type === "ARTIFACT_READY") {
    const artifactSection = renderArtifact(msg.payload as KnowledgeArtifact);
    const existing = document.querySelector(".artifact");
    if (existing) {
      existing.outerHTML = artifactSection;
    } else {
      app.insertAdjacentHTML("beforeend", artifactSection);
    }
  }
});

init();
