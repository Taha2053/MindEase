// ============================================================
// popup/popup.ts — Extension popup panel logic
// Displays two states:
//   1. Waiting — no artifact yet (initial / between sessions)
//   2. Results — full knowledge artifact with stats, cards, gaps
// ============================================================

import browser from "webextension-polyfill";
import type { KnowledgeArtifact, ExtensionMessage } from "@/types";

// ── DOM root ───────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;

// ── State 1: Waiting screen ────────────────────────────────────────────────────

function renderWaiting(): void {
  app.innerHTML = `
    <div class="waiting">
      <div class="logo">MindEase</div>
      <p class="sub">Start studying to generate<br/>your session summary</p>
    </div>
  `;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Truncate text to `max` chars, appending … if longer */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "\u2026";
}

/** CSS class for each severity level */
function severityClass(severity: string): string {
  switch (severity) {
    case "skipped": return "skipped";
    case "skimmed": return "skimmed";
    case "rushed":  return "rushed";
    default:        return "";
  }
}

/** Format line-height class based on card format */
function bodyClass(format: string): string {
  return format === "spaced-list" ? "card-body spaced" : "card-body";
}

/** Card container class based on format */
function cardClass(format: string): string {
  return format === "visual" ? "study-card visual" : "study-card";
}

// ── Section B: Study Cards ─────────────────────────────────────────────────────

function renderCards(artifact: KnowledgeArtifact): string {
  if (artifact.learnedCards.length === 0) {
    return `<p style="font-size:0.8rem;color:#666;">No concepts recorded yet.</p>`;
  }

  return artifact.learnedCards
    .map(
      (card) => `
        <div class="${cardClass(card.format)}">
          <div class="card-header">
            <span class="card-concept">${escapeHtml(card.concept)}</span>
            ${card.reviewFlag ? '<span class="review-badge">Review</span>' : ""}
          </div>
          <div class="${bodyClass(card.format)}">${escapeHtml(card.content)}</div>
        </div>
      `,
    )
    .join("");
}

// ── Section C: Gaps List ──────────────────────────────────────────────────────

function renderGaps(artifact: KnowledgeArtifact): string {
  if (artifact.gaps.length === 0) {
    return `<p style="font-size:0.8rem;color:#666;">No gaps detected. Nice!</p>`;
  }

  return artifact.gaps
    .map(
      (gap) => `
        <div class="gap-item">
          <div class="gap-header">
            <span class="gap-concept">${escapeHtml(gap.conceptLabel)}</span>
            <span class="severity-badge ${severityClass(gap.severity)}">${gap.severity}</span>
          </div>
          <div class="gap-text">${escapeHtml(truncate(gap.text, 80))}</div>
        </div>
      `,
    )
    .join("");
}

// ── State 2: Artifact results ──────────────────────────────────────────────────

function renderArtifact(artifact: KnowledgeArtifact): void {
  const learnedCount = artifact.learnedCards.length;
  const gapsCount    = artifact.gaps.length;
  const connectCount = artifact.connections.length;

  app.innerHTML = `
    <div class="artifact">

      <!-- Section A — Session Stats -->
      <div class="stats">
        <div class="stat-card">
          <div class="num">${learnedCount}</div>
          <div class="label">Learned</div>
        </div>
        <div class="stat-card">
          <div class="num">${gapsCount}</div>
          <div class="label">Gaps</div>
        </div>
        <div class="stat-card">
          <div class="num">${connectCount}</div>
          <div class="label">Connections</div>
        </div>
      </div>

      <!-- Section B — Study Cards -->
      <div class="section-title">Study Cards</div>
      <div class="scroll-list">
        ${renderCards(artifact)}
      </div>

      <!-- Section C — Gaps List -->
      <div class="section-title">Gaps</div>
      <div class="scroll-list">
        ${renderGaps(artifact)}
      </div>

    </div>
  `;
}

// ── XSS escape helper ──────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Check if a completed artifact already exists in storage
  const result = await browser.storage.local.get("latestArtifact");

  if (result.latestArtifact) {
    renderArtifact(result.latestArtifact as KnowledgeArtifact);
  } else {
    renderWaiting();
  }
}

// ── Live updates ───────────────────────────────────────────────────────────────
// When Layer 3 finishes synthesis it sends ARTIFACT_READY to this panel

browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as ExtensionMessage;
  if (msg.type === "ARTIFACT_READY") {
    renderArtifact(msg.payload as KnowledgeArtifact);
  }
});

init();
