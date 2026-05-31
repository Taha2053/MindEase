import browser from "webextension-polyfill";
import type { FullCognitiveProfile, SessionStats, PersonalizedArtifact, ExtensionMessage, HighlightNote, AdaptationExplanation, UserOverrides, TransformationParams, WorkspaceSession } from "@/types";
import type { Theme } from "@/utils/themeManager";
import { STORAGE_KEYS } from "@/types";
import { initTheme, toggleTheme, getAppliedTheme } from "@/utils/themeManager";
import { loadExplanations } from "@/layer2/explainer";
import { loadOverrides, saveOverrides, clearOverrides, paramLabel, paramOptions } from "@/layer2/userControls";
import { iconHTML } from "@/utils/icons";

const app = document.getElementById("app")!;
let _theme: Theme = "dark";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "\u2026";
}

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "0m";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

/* ── Theme toggle ── */
function setupThemeToggle(): void {
  const btn = document.getElementById("theme-toggle") as HTMLButtonElement | null;
  if (!btn) return;
  _theme = getAppliedTheme();
  btn.innerHTML = iconHTML(_theme === "light" ? "moon" : "sun");
  btn.addEventListener("click", async () => {
    const next = await toggleTheme();
    btn.innerHTML = iconHTML(next === "light" ? "moon" : "sun");
  });
}

/* ── Session Bar ── */
function renderSessionBar(session: WorkspaceSession | null, extActive: boolean): string {
  let indicator = "idle";
  let statusText = "No active session";
  let timerText = "Extension is idle";
  let actionBtn = "";

  if (extActive && session) {
    if (session.state === "active") {
      indicator = "active";
      statusText = "Studying";
      timerText = `${fmtDuration(Date.now() - session.startTime)} elapsed`;
      actionBtn = `<button class="session-btn stop" id="session-stop-btn">\u25A0 Stop</button>`;
    } else if (session.state === "passive") {
      indicator = "paused";
      statusText = "Paused";
      timerText = `Took a break`;
      actionBtn = `<button class="session-btn resume" id="session-resume-btn">\u25B6 Resume</button>`;
    } else {
      indicator = "active";
      statusText = "Active";
      timerText = `${fmtDuration(Date.now() - session.startTime)} elapsed`;
      actionBtn = `<button class="session-btn stop" id="session-stop-btn">\u25A0 Stop</button>`;
    }
  } else {
    actionBtn = `<button class="session-btn start" id="session-start-btn">\u25B6 Start Session</button>`;
  }

  return `
    <div class="session-bar">
      <span class="session-indicator ${indicator}"></span>
      <div class="session-info">
        <div class="session-status">${statusText}</div>
        <div class="session-timer">${timerText}</div>
      </div>
      <div class="session-actions">${actionBtn}</div>
    </div>
  `;
}

/* ── Tab List ── */
function renderTabList(session: WorkspaceSession | null, excludedTabs: Record<number, boolean>): string {
  if (!session || !session.tabs || session.tabs.length === 0) return "";

  const distractionDomains = ["facebook.com", "twitter.com", "x.com", "instagram.com", "tiktok.com", "reddit.com", "youtube.com", "netflix.com", "twitch.tv", "whatsapp.com", "discord.com"];

  const tabRows = session.tabs.map(tab => {
    const hostname = new URL(tab.url).hostname.replace("www.", "");
    const isDistraction = distractionDomains.some(d => hostname.includes(d));
    const excluded = excludedTabs[tab.tabId] === true;
    const badge = excluded ? "excluded" : isDistraction ? "distraction" : "included";
    const label = excluded ? "Excluded" : isDistraction ? "Distraction" : "Included";
    const toggleIcon = excluded ? iconHTML("circle") : iconHTML("check-circle");
    const toggleCls = excluded ? "" : "on";

    return `
      <div class="tab-row" data-tab-id="${tab.tabId}">
        <img class="tab-favicon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=16" alt="" loading="lazy" />
        <span class="tab-title">${escapeHtml(truncate(tab.title || hostname, 35))}</span>
        <span class="tab-badge ${badge}">${label}</span>
        <button class="tab-toggle ${toggleCls}" data-tab-id="${tab.tabId}" title="${excluded ? "Click to include" : "Click to exclude"}">${toggleIcon}</button>
      </div>
    `;
  }).join("");

  return `
    <div class="section-title">Tabs in Session (${session.tabs.length})</div>
    <div class="tab-list">${tabRows}</div>
  `;
}

function wireTabToggles(excludedTabs: Record<number, boolean>): void {
  document.querySelectorAll(".tab-toggle").forEach(btn => {
    const existing = (btn as HTMLElement).dataset._wired;
    if (existing) return;
    (btn as HTMLElement).dataset._wired = "1";

    btn.addEventListener("click", async () => {
      const tabId = Number((btn as HTMLElement).dataset.tabId);
      if (!tabId) return;
      const currentlyExcluded = excludedTabs[tabId] === true;

      if (currentlyExcluded) {
        delete excludedTabs[tabId];
      } else {
        excludedTabs[tabId] = true;
      }
      await browser.storage.local.set({ [STORAGE_KEYS.EXCLUDED_TABS]: excludedTabs });

      const row = (btn as HTMLElement).closest(".tab-row");
      if (!row) return;
      const badge = row.querySelector(".tab-badge");
      if (!badge) return;

      if (currentlyExcluded) {
        // Revert to auto-detection
        const hostname = new URL((row.querySelector(".tab-title")?.textContent || ""), "https://example.com").hostname;
        const distractionDomains = ["facebook.com", "twitter.com", "x.com", "instagram.com", "tiktok.com", "reddit.com", "youtube.com", "netflix.com", "twitch.tv", "whatsapp.com", "discord.com"];
        const isDistraction = distractionDomains.some(d => hostname.includes(d));
        badge.className = `tab-badge ${isDistraction ? "distraction" : "included"}`;
        badge.textContent = isDistraction ? "Distraction" : "Included";
      } else {
        badge.className = "tab-badge excluded";
        badge.textContent = "Excluded";
      }
      btn.classList.toggle("on", currentlyExcluded);
      (btn as HTMLElement).innerHTML = iconHTML(currentlyExcluded ? "check-circle" : "circle");
      (btn as HTMLElement).title = currentlyExcluded ? "Click to exclude" : "Click to include";
    });
  });
}

/* ── Profile panel ── */
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
      <button id="edit-profile-btn" class="btn btn-primary">Edit Profile</button>
      <button id="reset-profile-btn" class="btn btn-ghost">Reset All</button>
    </div>
    <div style="margin-top:10px">
      <button id="view-reflection-btn" class="btn btn-primary" style="width:100%">${iconHTML("bar-chart-3")} Session Dashboard</button>
    </div>
  `;
}

function renderNoProfile(): string {
  return `
    <div class="waiting">
      <div class="w-icon">${iconHTML("brain")}</div>
      <div class="w-title">Welcome to MindEase</div>
      <p class="w-sub">Complete the onboarding to personalize your learning experience.</p>
      <button id="start-onboarding-btn" class="btn btn-primary" style="margin-top:16px;padding:10px 24px">Start Onboarding</button>
    </div>
  `;
}

/* ── Content Controls ── */
function renderControlRow(key: keyof TransformationParams, currentValue: string | boolean | number, overrides: UserOverrides): string {
  const options = paramOptions(key);
  const overrideVal: string | boolean | number | undefined = overrides.enabled
    ? (overrides as unknown as Record<string, unknown>)[key] as string | boolean | number | undefined
    : undefined;
  const isOverridden = overrideVal !== undefined;
  const displayVal: string | boolean | number = isOverridden ? overrideVal : currentValue;
  const labelMap: Record<string, string> = {
    chunkSize: "Chunk Size", simplificationLevel: "Simplify", captionSpeed: "Pace",
    useVisualAnchors: "Visuals", summaryFrequency: "Summaries",
  };
  return `
    <div class="control-row">
      <span class="control-label">${labelMap[key] || key}</span>
      <span class="control-value ${isOverridden ? "overridden" : ""}">${escapeHtml(paramLabel(key, displayVal))}</span>
      <div class="control-btns" data-control-key="${key}" data-current="${String(displayVal)}">
        ${options.map(opt => {
          const active = String(opt) === String(displayVal);
          const cls = active ? (isOverridden ? "control-btn active-override" : "control-btn active") : "control-btn";
          return `<button class="${cls}" data-value="${String(opt)}">${escapeHtml(paramLabel(key, opt))}</button>`;
        }).join("")}
      </div>
    </div>
  `;
}

/* ── Artifact panels ── */
function severityBadge(severity: string): string {
  const map: Record<string, string> = { skipped: "Skipped", skimmed: "Skimmed", rushed: "Rushed" };
  const clsMap: Record<string, string> = { skipped: "badge-skipped", skimmed: "badge-skimmed", rushed: "badge-rushed" };
  return map[severity] ? `<span class="badge ${clsMap[severity]}">${map[severity]}</span>` : "";
}
function renderResourcesUsed(artifact: PersonalizedArtifact): string {
  const r = artifact.resourcesUsed;
  if (!r?.length) return "";
  return `<div class="section-title">1. Resources Used</div><div class="scroll-list">${r.map(res => `
    <div class="item-card">
      <div class="ic-concept">${escapeHtml(truncate(res.title || res.url, 45))}</div>
      <div class="ic-body">${escapeHtml(truncate(res.url, 50))}</div>
      <div style="font-size:0.62rem;color:var(--text-muted);margin-top:4px">${fmtDuration(res.timeSpentMs)} &middot; ${res.notesCount} notes</div>
    </div>`).join("")}</div>`;
}
function renderKeyConcepts(artifact: PersonalizedArtifact): string {
  const kc = artifact.keyConcepts;
  if (!kc?.length) return "";
  return `<div class="section-title">2. Key Concepts</div><div class="scroll-list">${kc.slice(0, 10).map(c => {
    const pct = Math.round(c.engagementScore * 100);
    return `<div class="item-card"><div class="ic-header"><span class="ic-concept">${escapeHtml(c.label)}</span><span class="badge ${pct >= 60 ? "badge-review" : "badge-skimmed"}">${pct}%</span></div><div class="ic-body">${c.occurrences} occurrence(s) across ${c.sources.length} source(s)</div></div>`;
  }).join("")}</div>`;
}
function renderCrossSourceConnections(artifact: PersonalizedArtifact): string {
  const xs = artifact.crossSourceConnections;
  if (!xs?.length) return "";
  return `<div class="section-title">Cross-Source Connections</div><div class="scroll-list">${xs.slice(0, 4).map(c => `
    <div class="item-card">
      <div class="ic-concept" style="color:var(--accent);font-weight:700">${escapeHtml(c.conceptLabel)}</div>
      <div style="margin-top:4px">${c.resources.map(r => `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:0.72rem"><span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.6rem;font-weight:600;background:rgba(100,116,139,0.15);color:var(--text-dim)">${escapeHtml(r.type)}</span><span style="color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${escapeHtml(truncate(r.title, 25))}</span></div>`).join("")}</div>
      <div style="font-size:0.62rem;color:var(--text-muted);margin-top:4px">${c.matchCount} sources &middot; ${c.matchType}</div>
    </div>`).join("")}</div>`;
}
function cleanNoteText(raw: string): string {
  return raw
    .replace(/\[CHUNK\s*\d*\]/gi, "")
    .replace(/^---+$/gm, "")
    .replace(/\[\/?[A-Z]+\]/g, "")
    .replace(/\u2605\s*/g, "")
    .replace(/&#9734;\s*/g, "")
    .replace(/\s{3,}/g, "  ")
    .trim();
}
function renderUserNotes(notes: HighlightNote[]): string {
  if (!notes?.length) return "";
  const maxLen = 200;
  return `<div class="section-title">3. User Notes</div><div class="scroll-list">${notes.slice(-10).reverse().map(n => {
    const cleaned = cleanNoteText(n.text);
    const displayText = cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "\u2026" : cleaned;
    return `
    <div class="item-card" style="border-left:3px solid var(--accent)">
      <div class="ic-body" style="font-style:italic;color:var(--text-primary)">\u201C${escapeHtml(displayText)}\u201D</div>
      <div style="font-size:0.62rem;color:var(--text-muted);margin-top:4px;display:flex;gap:6px"><span style="color:var(--accent)">${escapeHtml(truncate(n.resourceTitle || n.sourceUrl, 30))}</span><span>${new Date(n.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
    </div>`;
  }).join("")}</div>`;
}
function renderNeedsReview(artifact: PersonalizedArtifact): string {
  const gaps = artifact.needsReview;
  return `<div class="section-title">4. Needs Review</div>${!gaps?.length ? `<p style="font-size:0.8rem;color:var(--text-muted);padding:8px 0">No gaps detected &mdash; great focus!</p>` : `<div class="scroll-list">${gaps.map(g => `
    <div class="item-card"><div class="ic-header"><span class="ic-concept">${escapeHtml(g.conceptLabel)}</span>${severityBadge(g.severity)}</div><div class="ic-body">${escapeHtml(truncate(g.text, 80))}</div></div>`).join("")}</div>`}`;
}
function renderStudyCards(artifact: PersonalizedArtifact): string {
  const cards = artifact.studyCards;
  return `<div class="section-title">5. Study Cards</div>${!cards?.length ? `<p style="font-size:0.8rem;color:var(--text-muted);padding:8px 0">No concepts recorded yet.</p>` : `<div class="scroll-list">${cards.map(card => `
    <div class="item-card"><div class="ic-header"><span class="ic-concept">${escapeHtml(card.concept)}</span>${card.reviewFlag ? '<span class="badge badge-review">Review</span>' : ""}</div><div class="ic-body">${escapeHtml(truncate(card.content, 100))}</div></div>`).join("")}</div>`}`;
}
function renderFocusSummary(artifact: PersonalizedArtifact): string {
  const f = artifact.focusSummary;
  if (!f || f.totalDurationMs <= 0) return "";
  const pct = Math.round(f.focusScore * 100);
  let color = "var(--danger)";
  if (pct >= 60) color = "var(--warning)";
  if (pct >= 80) color = "var(--success)";
  return `<div class="section-title">6. Focus Summary</div><div class="profile-card"><div class="profile-grid">
    <div class="profile-item"><span class="pi-label">Duration</span><span class="pi-value">${fmtDuration(f.totalDurationMs)}</span></div>
    <div class="profile-item"><span class="pi-label">Focused Time</span><span class="pi-value">${fmtDuration(f.focusedTimeMs)}</span></div>
    <div class="profile-item"><span class="pi-label">Interruptions</span><span class="pi-value">${f.interruptionCount}</span></div>
    <div class="profile-item"><span class="pi-label">Longest Break</span><span class="pi-value">${fmtDuration(f.longestInterruptionMs)}</span></div>
  </div>
  <div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-bottom:4px"><span>Focus Score</span><span style="color:${color};font-weight:600">${pct}%</span></div><div style="height:6px;background:var(--bg-surface-alt);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width 0.5s"></div></div></div></div>`;
}
function renderResourceSummary(artifact: PersonalizedArtifact): string {
  const rs = artifact.resourceSummary;
  if (!rs?.length) return "";
  return `<div class="section-title">7. Resource Summary</div><div class="scroll-list">${rs.map(r => `
    <div class="item-card"><div class="ic-concept">${escapeHtml(truncate(r.title || r.url, 40))}</div><div style="font-size:0.68rem;color:var(--text-dim);margin-top:3px">${fmtDuration(r.timeSpentMs)} &middot; ${r.notesCount} notes${r.conceptsFound.length > 0 ? ` &middot; ${r.conceptsFound.slice(0, 3).join(", ")}` : ""}</div></div>`).join("")}</div>`;
}

function renderArtifact(artifact: PersonalizedArtifact): string {
  return `
    <div class="hr"></div>
    <div class="section-title">Session Summary</div>
    <div class="stats-row">
      <div class="stat-card"><span class="num">${artifact.studyCards.length}</span><span class="label">Cards</span></div>
      <div class="stat-card"><span class="num">${artifact.needsReview.length}</span><span class="label">Gaps</span></div>
      <div class="stat-card"><span class="num">${artifact.userNotes.length}</span><span class="label">Notes</span></div>
      <div class="stat-card"><span class="num">${Math.round(artifact.focusSummary.focusScore * 100)}%</span><span class="label">Focus</span></div>
    </div>
    ${renderResourcesUsed(artifact)}
    ${renderKeyConcepts(artifact)}
    ${renderCrossSourceConnections(artifact)}
    ${renderUserNotes(artifact.userNotes)}
    ${renderNeedsReview(artifact)}
    ${renderStudyCards(artifact)}
    ${renderFocusSummary(artifact)}
    ${renderResourceSummary(artifact)}
  `;
}

/* ── Init ── */
async function init(): Promise<void> {
  _theme = await initTheme();
  /* Replace static data-lucide placeholders with inline SVGs */
  document.querySelectorAll("[data-lucide]").forEach(el => {
    const name = el.getAttribute("data-lucide");
    if (name) {
      const svg = iconHTML(name, el.getAttribute("class") || "");
      el.outerHTML = svg;
    }
  });
  setupThemeToggle();

  const results = await browser.storage.local.get([
    STORAGE_KEYS.PROFILE,
    STORAGE_KEYS.SESSION_STATS,
    STORAGE_KEYS.NOTES,
    STORAGE_KEYS.EXTENSION_ACTIVE,
    STORAGE_KEYS.WORKSPACE,
    STORAGE_KEYS.EXCLUDED_TABS,
    "latestArtifact",
  ]);

  const profile = results[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
  const workspace = (results[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | undefined) ?? null;
  const extActive = results[STORAGE_KEYS.EXTENSION_ACTIVE] === true;
  const stats = (results[STORAGE_KEYS.SESSION_STATS] as SessionStats | undefined) ?? {
    engagedSections: [], skippedSections: [], totalHighlights: 0, totalPauses: 0, totalSkips: 0, dominantSignal: "pause" as const,
  };
  const artifact = results["latestArtifact"] as PersonalizedArtifact | undefined;
  const notesCollection = results[STORAGE_KEYS.NOTES] as { notes: HighlightNote[] } | undefined;
  const excludedTabs: Record<number, boolean> = results[STORAGE_KEYS.EXCLUDED_TABS] as Record<number, boolean> || {};

  // Build HTML
  let html = renderSessionBar(workspace, extActive);

  if (profile) {
    // Tab list (only shown when session is active)
    if (extActive && workspace) {
      html += renderTabList(workspace, excludedTabs);
    }

    html += renderProfile(profile, stats);

    // Content Controls
    const overrides = await loadOverrides();
    const p = profile.transformationParams;
    const isActive = overrides.enabled && Object.keys(overrides).some(k =>
      ["chunkSize", "simplificationLevel", "captionSpeed", "useVisualAnchors", "summaryFrequency"].includes(k)
      && (overrides as unknown as Record<string, unknown>)[k] !== undefined
    );

    html += `
      <button class="controls-toggle" id="controls-toggle">
        <span class="ct-label">${iconHTML("settings")} Content Controls</span>
        <span class="ct-badge ${isActive ? "ct-badge-on" : "ct-badge-off"}">${isActive ? "Custom" : "Auto"}</span>
        <span class="ct-arrow" id="ct-arrow">${iconHTML("chevron-down")}</span>
      </button>
      <div class="controls-panel" id="controls-panel">
        ${renderControlRow("chunkSize", p.chunkSize, overrides)}
        ${renderControlRow("simplificationLevel", p.simplificationLevel, overrides)}
        ${renderControlRow("captionSpeed", p.captionSpeed, overrides)}
        ${renderControlRow("useVisualAnchors", p.useVisualAnchors, overrides)}
        ${renderControlRow("summaryFrequency", p.summaryFrequency, overrides)}
        <div class="controls-footer">
          <button id="reset-controls-btn" class="btn btn-ghost" style="flex:1">Reset to RL Defaults</button>
        </div>
      </div>
    `;
  } else {
    html += renderNoProfile();
  }

  if (artifact) html += renderArtifact(artifact);

  // Explanations
  const explanations = await loadExplanations();
  const activeExps = Object.values(explanations).filter((e): e is AdaptationExplanation => e !== null);
  if (activeExps.length > 0) {
    html += `<div class="hr"></div><div class="section-title">Why MindEase Adapted This Content</div><div style="display:flex;flex-direction:column;gap:6px">${activeExps.slice(0, 3).map(e => `
      <div style="background:var(--bg-surface-alt);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:0.75rem">
        <strong style="color:var(--accent)">${escapeHtml(e.title)}</strong>
        <p style="margin:4px 0 0;color:var(--text-dim);line-height:1.5">${escapeHtml(e.explanation)}</p>
      </div>`).join("")}</div>`;
  }

  // Standalone notes
  if (notesCollection?.notes?.length && !artifact) {
    const maxLen = 200;
    html += `<div class="hr"></div><div class="section-title">Personal Notes</div><div class="tab-list">${notesCollection.notes.slice(-10).reverse().map(n => {
      const cleaned = cleanNoteText(n.text);
      const displayText = cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "\u2026" : cleaned;
      return `
      <div class="item-card" style="border-left:3px solid var(--accent)">
        <div class="ic-body" style="font-style:italic;color:var(--text-primary)">\u201C${escapeHtml(displayText)}\u201D</div>
        <div style="font-size:0.62rem;color:var(--text-muted);margin-top:4px;display:flex;gap:6px"><span style="color:var(--accent)">${escapeHtml(truncate(n.resourceTitle || n.sourceUrl, 30))}</span><span>${new Date(n.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
      </div>`;
    }).join("")}</div>`;
  }

  app.innerHTML = html;

  // ── Wire tab toggles ──
  wireTabToggles(excludedTabs);

  // ── Event wiring ──
  document.getElementById("session-start-btn")?.addEventListener("click", async () => {
    // Clear previous session's tabs — each session gets its own tabs
    await browser.storage.local.set({
      [STORAGE_KEYS.EXTENSION_ACTIVE]: true,
      [STORAGE_KEYS.WORKSPACE]: null,
      [STORAGE_KEYS.EXCLUDED_TABS]: {},
    });
    await browser.runtime.sendMessage({ type: "SESSION_STATE_CHANGED", payload: { active: true } }).catch(() => {});
    // Reload current tabs to activate content script
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { type: "EXTENSION_STATE_CHANGED", active: true }).catch(() => {});
      }
    }
    window.location.reload();
  });

  document.getElementById("session-stop-btn")?.addEventListener("click", async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.EXTENSION_ACTIVE]: false });
    await browser.runtime.sendMessage({ type: "SESSION_END" }).catch(() => {});
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { type: "EXTENSION_STATE_CHANGED", active: false }).catch(() => {});
      }
    }
    window.location.reload();
  });

  document.getElementById("session-resume-btn")?.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "SESSION_STATE_CHANGED", payload: { active: true } }).catch(() => {});
    window.location.reload();
  });

  document.getElementById("edit-profile-btn")?.addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html?edit=1"), active: true });
  });

  document.getElementById("reset-profile-btn")?.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "RESET_PROFILE" }).catch(() => {});
    await browser.tabs.create({ url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"), active: true });
  });

  document.getElementById("start-onboarding-btn")?.addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"), active: true });
  });

  document.getElementById("view-reflection-btn")?.addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("src/session/dashboard/dashboard.html"), active: true });
  });

  // Content Controls
  const toggleBtn = document.getElementById("controls-toggle");
  const panel = document.getElementById("controls-panel");
  const arrow = document.getElementById("ct-arrow");
  let controlsOpen = false;
  toggleBtn?.addEventListener("click", () => {
    controlsOpen = !controlsOpen;
    panel?.classList.toggle("open", controlsOpen);
    arrow?.classList.toggle("open", controlsOpen);
  });

  document.getElementById("reset-controls-btn")?.addEventListener("click", async () => {
    await clearOverrides();
    browser.runtime.sendMessage({ type: "CONTROLS_CHANGED" }).catch(() => {});
    window.location.reload();
  });

  document.querySelectorAll(".control-btns").forEach(group => {
    group.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest(".control-btn") as HTMLButtonElement | null;
      if (!btn) return;
      const key = (group as HTMLElement).dataset.controlKey;
      const value = btn.dataset.value;
      if (!key || value === undefined) return;
      let parsed: string | boolean | number = value;
      if (value === "true") parsed = true;
      else if (value === "false") parsed = false;
      else if (!isNaN(Number(value)) && value !== "") parsed = Number(value);
      const ov = await loadOverrides();
      ov.enabled = true;
      (ov as unknown as Record<string, unknown>)[key] = parsed;
      await saveOverrides(ov);
      browser.runtime.sendMessage({ type: "CONTROLS_CHANGED" }).catch(() => {});
      const row = group.closest(".control-row");
      if (row) {
        const valEl = row.querySelector(".control-value");
        if (valEl) { valEl.textContent = paramLabel(key as keyof TransformationParams, parsed); valEl.classList.add("overridden"); }
        group.querySelectorAll(".control-btn").forEach(b => (b as HTMLButtonElement).classList.remove("active", "active-override"));
        btn.classList.add("active-override");
      }
      const badge = toggleBtn?.querySelector(".ct-badge");
      if (badge) { badge.textContent = "Custom"; badge.className = "ct-badge ct-badge-on"; }
    });
  });
}

/* ── Live updates ── */
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as ExtensionMessage;
  if (msg.type === "HIGHLIGHTS_UPDATED") {
    browser.storage.local.get(STORAGE_KEYS.NOTES).then((updated) => {
      const data = updated[STORAGE_KEYS.NOTES] as { notes: HighlightNote[] } | undefined;
      if (data?.notes?.length) {
        const existing = document.querySelector(".section-title");
        if (!existing || !existing.textContent?.includes("Notes")) {
          app.insertAdjacentHTML("beforeend", renderUserNotes(data.notes));
        }
      }
    });
  }
  if (msg.type === "ARTIFACT_READY") {
    window.location.reload();
  }
});

init();
