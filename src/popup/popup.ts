import browser from "webextension-polyfill";
import type { FullCognitiveProfile, SessionStats, KnowledgeArtifact, ExtensionMessage } from "@/types";
import { STORAGE_KEYS } from "@/types";

const app = document.getElementById("app")!;

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "\u2026";
}

/* ── Layer 2: Profile panel ───────────────────────────────────── */

function renderProfile(profile: FullCognitiveProfile, stats: SessionStats): string {
  const p = profile.transformationParams;
  return `
    <div class="stats-row">
      <div class="stat-card">
        <span class="num">${stats.totalHighlights}</span>
        <span class="label">Highlights</span>
      </div>
      <div class="stat-card">
        <span class="num">${stats.totalPauses}</span>
        <span class="label">Pauses</span>
      </div>
      <div class="stat-card">
        <span class="num">${stats.totalSkips}</span>
        <span class="label">Skips</span>
      </div>
    </div>

    <div class="section-title">Cognitive Profile</div>
    <div class="profile-card">
      <div class="profile-grid">
        <div class="profile-item">
          <span class="pi-label">Format</span>
          <span class="pi-value">${profile.baseline.formatPreference}</span>
        </div>
        <div class="profile-item">
          <span class="pi-label">Attention</span>
          <span class="pi-value">${profile.baseline.attentionSpan}</span>
        </div>
        <div class="profile-item">
          <span class="pi-label">Chunk Size</span>
          <span class="pi-value">${p.chunkSize}</span>
        </div>
        <div class="profile-item">
          <span class="pi-label">Simplify Level</span>
          <span class="pi-value">${p.simplificationLevel}</span>
        </div>
        <div class="profile-item">
          <span class="pi-label">Reading Pace</span>
          <span class="pi-value">${profile.baseline.readingPace}</span>
        </div>
        <div class="profile-item">
          <span class="pi-label">Sessions</span>
          <span class="pi-value">${profile.rlState.sessionCount}</span>
        </div>
      </div>
    </div>

    <div class="btn-group">
      <button id="end-session-btn" class="btn btn-primary">End Session</button>
      <button id="reset-profile-btn" class="btn btn-danger">Reset</button>
    </div>
  `;
}

function renderNoProfile(): string {
  return `
    <div class="waiting">
      <div class="w-icon">&#x1F9E0;</div>
      <div class="w-title">Welcome to MindEase</div>
      <p class="w-sub">Complete the onboarding to personalize your learning experience.</p>
      <button id="start-onboarding-btn" class="btn btn-primary" style="margin-top:16px;padding:10px 24px;font-size:0.83rem">Start Onboarding</button>
    </div>
  `;
}

/* ── Layer 3: Artifact panel ──────────────────────────────────── */

function severityBadge(severity: string): string {
  switch (severity) {
    case "skipped": return `<span class="badge badge-skipped">Skipped</span>`;
    case "skimmed": return `<span class="badge badge-skimmed">Skimmed</span>`;
    case "rushed":  return `<span class="badge badge-rushed">Rushed</span>`;
    default:        return "";
  }
}

function renderCards(artifact: KnowledgeArtifact): string {
  if (artifact.learnedCards.length === 0) {
    return '<p style="font-size:0.78rem;color:#475569;">No concepts recorded yet.</p>';
  }
  return artifact.learnedCards.map((card) => `
    <div class="item-card">
      <div class="ic-header">
        <span class="ic-concept">${escapeHtml(card.concept)}</span>
        ${card.reviewFlag ? '<span class="badge badge-review">Review</span>' : ""}
      </div>
      <div class="ic-body">${escapeHtml(truncate(card.content, 100))}</div>
    </div>
  `).join("");
}

function renderGaps(artifact: KnowledgeArtifact): string {
  if (artifact.gaps.length === 0) {
    return '<p style="font-size:0.78rem;color:#475569;">No gaps detected.</p>';
  }
  return artifact.gaps.map((gap) => `
    <div class="item-card">
      <div class="ic-header">
        <span class="ic-concept">${escapeHtml(gap.conceptLabel)}</span>
        ${severityBadge(gap.severity)}
      </div>
      <div class="ic-body">${escapeHtml(truncate(gap.text, 80))}</div>
    </div>
  `).join("");
}

function renderArtifact(artifact: KnowledgeArtifact): string {
  return `
    <div class="hr"></div>
    <div class="section-title">Session Artifact</div>
    <div class="stats-row">
      <div class="stat-card">
        <span class="num">${artifact.learnedCards.length}</span>
        <span class="label">Learned</span>
      </div>
      <div class="stat-card">
        <span class="num">${artifact.gaps.length}</span>
        <span class="label">Gaps</span>
      </div>
      <div class="stat-card">
        <span class="num">${artifact.connections.length}</span>
        <span class="label">Connections</span>
      </div>
    </div>
    <div class="section-title">Study Cards</div>
    <div class="scroll-list">${renderCards(artifact)}</div>
    <div class="section-title">Gaps</div>
    <div class="scroll-list">${renderGaps(artifact)}</div>
  `;
}

/* ── Actions ───────────────────────────────────────────────────── */

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

/* ── Init ──────────────────────────────────────────────────────── */

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
  document.getElementById("start-onboarding-btn")?.addEventListener("click", async () => {
    await browser.tabs.create({
      url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"),
      active: true,
    });
  });
}

/* ── Live updates from Layer 3 ─────────────────────────────────── */

browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as ExtensionMessage;
  if (msg.type === "ARTIFACT_READY") {
    const artifactSection = renderArtifact(msg.payload as KnowledgeArtifact);
    const existing = document.querySelector(".section-title:first-of-type");
    if (existing) {
      const parent = existing.closest(".body-wrap") ?? app;
      const hr = parent.querySelector(".hr");
      if (hr) hr.remove();
      const sections = parent.querySelectorAll(".section-title");
      sections.forEach(s => {
        const cardContainer = s.nextElementSibling;
        if (cardContainer?.classList.contains("scroll-list")) {
          cardContainer.remove();
        }
        s.remove();
      });
      const statsRow = parent.querySelector(".stats-row:last-of-type");
      if (statsRow && !statsRow.previousElementSibling?.classList.contains("section-title")) {
        statsRow.remove();
      }
    }
    app.insertAdjacentHTML("beforeend", artifactSection);
  }
});

init();
