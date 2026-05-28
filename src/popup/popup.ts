// ============================================================
// popup/popup.ts — Extension popup panel logic
// Displays the session status and the knowledge artifact
// once Layer 3 synthesis is complete.
// ============================================================

import browser from "webextension-polyfill";
import type { KnowledgeArtifact } from "@/types";

// ── DOM references ────────────────────────────────────────────────────────────

const root = document.body;

// ── Render helpers ────────────────────────────────────────────────────────────

function renderWaiting(): void {
  root.innerHTML = `
    <h1 style="color:#a78bfa">MindEase</h1>
    <p>No session artifact yet.<br/>Start studying to generate your knowledge card.</p>
  `;
}

function renderArtifact(artifact: KnowledgeArtifact): void {
  const learnedCount  = artifact.learnedCards.length;
  const gapsCount     = artifact.gaps.length;
  const connectCount  = artifact.connections.length;

  root.innerHTML = `
    <h1 style="color:#a78bfa">Session Summary</h1>
    <div style="margin-top:12px; width:100%">
      <div style="margin-bottom:8px">
        ✅ <strong>${learnedCount}</strong> concepts absorbed
      </div>
      <div style="margin-bottom:8px">
        ⚠️  <strong>${gapsCount}</strong> gaps flagged for review
      </div>
      <div style="margin-bottom:16px">
        🔗 <strong>${connectCount}</strong> cross-source connections
      </div>
      <button id="view-artifact" style="
        width:100%; padding:10px;
        background:#7c3aed; color:#fff;
        border:none; border-radius:8px;
        cursor:pointer; font-size:0.9rem;
      ">View Full Knowledge Artifact</button>
    </div>
  `;

  document.getElementById("view-artifact")?.addEventListener("click", () => {
    // TODO: open full artifact in a side panel tab
    console.log("[Popup] Opening full artifact…", artifact);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Check if a completed artifact exists in storage
  const result = await browser.storage.local.get("latestArtifact");

  if (result.latestArtifact) {
    renderArtifact(result.latestArtifact as KnowledgeArtifact);
  } else {
    renderWaiting();
  }
}

// Listen for artifact-ready signal from Layer 3
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; payload: unknown };
  if (msg.type === "ARTIFACT_READY") {
    renderArtifact(msg.payload as KnowledgeArtifact);
  }
});

init();
