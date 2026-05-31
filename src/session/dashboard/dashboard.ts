import "@/styles/theme.css";
import "./dashboard.css";
import browser from "webextension-polyfill";
import {
  initTheme, toggleTheme as themeManagerToggle,
  getAppliedTheme, type Theme,
} from "@/utils/themeManager";
import { iconHTML } from "@/utils/icons";
import { renderLatex } from "@/utils/latex";
import { STORAGE_KEYS } from "@/types";
import type {
  WorkspaceSession, FullCognitiveProfile, PersonalizedArtifact,
  ResourceEntry, KeyConceptEntry, StudyCard, Gap, HighlightNote,
  Connection, TabResource, FocusSummary, StateTransition,
  SessionState, AdaptationExplanation, ExplanationMap,
  CrossSourceConnection, CrossSourceResource,
} from "@/types";
import { loadExplanations } from "@/layer2/explainer";

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function fmtDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m ${sec % 60}s`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function fmtDurationShort(ms: number): string {
  if (ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m`;
  return `${sec}s`;
}

function cleanNote(raw: string): string {
  return raw
    .replace(/\[CHUNK\s*\d*\]/gi, "")
    .replace(/^---+$/gm, "")
    .replace(/\[\/?[A-Z]+\]/g, "")
    .replace(/\u2605\s*/g, "")
    .replace(/&#9734;\s*/g, "")
    .replace(/\s{3,}/g, "  ")
    .trim();
}
function esc(text: string | number | undefined | null): string {
  if (text == null) return "";
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(String(text)));
  return div.innerHTML;
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "\u2026";
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function pct(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function sourceTypeIcon(type: string): string {
  switch (type) {
    case "pdf": return iconHTML("file-text");
    case "video": return iconHTML("film");
    case "website": return iconHTML("globe");
    case "lecture": return iconHTML("graduation-cap");
    default: return iconHTML("folder-open");
  }
}

function sourceTypeBadgeClass(type: string): string {
  return `resource-type-${type}`;
}

/* ─── Theme ────────────────────────────────────────────────────────────────── */

let _theme: Theme = "dark";

async function init(): Promise<void> {
  _theme = await initTheme();
  document.querySelectorAll("[data-lucide]").forEach(el => {
    const name = el.getAttribute("data-lucide");
    if (name) {
      const svg = iconHTML(name, el.getAttribute("class") || "");
      el.outerHTML = svg;
    }
  });
  setupThemeToggle();
  await loadDashboard();
}

function setupThemeToggle(): void {
  const btn = $("theme-toggle") as HTMLButtonElement | null;
  if (!btn) return;
  _theme = getAppliedTheme();
  btn.innerHTML = iconHTML(_theme === "light" ? "moon" : "sun");
  btn.addEventListener("click", async () => {
    const next = await themeManagerToggle();
    btn.innerHTML = iconHTML(next === "light" ? "moon" : "sun");
  });
  $("close-dashboard")?.addEventListener("click", () => window.close());
  $("export-pdf")?.addEventListener("click", exportAsPDF);
}

function exportAsPDF(): void {
  window.print();
}

/* ─── Data Loading ─────────────────────────────────────────────────────────── */

interface DashboardData {
  session: WorkspaceSession | null;
  artifact: PersonalizedArtifact | null;
  profile: FullCognitiveProfile | null;
  notes: HighlightNote[];
}

async function loadData(): Promise<DashboardData> {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.WORKSPACE,
    "latestArtifact",
    STORAGE_KEYS.PROFILE,
    STORAGE_KEYS.NOTES,
  ]);

  const session = result[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | null;
  const artifact = result["latestArtifact"] as PersonalizedArtifact | null;
  const profile = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | null;
  const notesCol = result[STORAGE_KEYS.NOTES] as { notes: HighlightNote[] } | null;

  return {
    session,
    artifact,
    profile,
    notes: notesCol?.notes ?? [],
  };
}

/* ─── Canvas Focus Timeline ────────────────────────────────────────────────── */

function drawFocusTimeline(canvas: HTMLCanvasElement | null, transitions: StateTransition[], startTime: number, endTime: number): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const duration = endTime - startTime;
  if (duration <= 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#1a2d45";
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const barY = 8;
  const barH = h - 16;
  const barR = 4;

  // Background track
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-surface-alt").trim() || "#0a1422";
  ctx.beginPath();
  ctx.roundRect(0, barY, w, barH, barR);
  ctx.fill();

  // Default to active if no transitions (single segment)
  if (!transitions || transitions.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--success").trim() || "#22c55e";
    ctx.beginPath();
    ctx.roundRect(2, barY + 2, w - 4, barH - 4, barR - 1);
    ctx.fill();
    return;
  }

  // Sort transitions by timestamp
  const sorted = [...transitions].sort((a, b) => a.timestamp - b.timestamp);

  // Color map
  const style = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {
    active: style.getPropertyValue("--success").trim() || "#22c55e",
    passive: style.getPropertyValue("--warning").trim() || "#eab308",
    suspended: style.getPropertyValue("--danger").trim() || "#ef4444",
  };

  let currentState: SessionState = "active";
  let segmentStart = startTime;

  for (const t of sorted) {
    const segStartX = ((segmentStart - startTime) / duration) * w;
    const segEndX = ((t.timestamp - startTime) / duration) * w;
    const segW = Math.max(2, segEndX - segStartX);

    ctx.fillStyle = colors[currentState] || "#64748b";
    ctx.beginPath();
    ctx.roundRect(segStartX, barY + 2, segW, barH - 4, 2);
    ctx.fill();

    currentState = t.toState;
    segmentStart = t.timestamp;
  }

  // Last segment to end
  const lastStartX = ((segmentStart - startTime) / duration) * w;
  const lastW = Math.max(2, w - lastStartX);
  ctx.fillStyle = colors[currentState] || "#64748b";
  ctx.beginPath();
  ctx.roundRect(lastStartX, barY + 2, lastW, barH - 4, 2);
  ctx.fill();
}

/* ─── Section 1: Session Overview ──────────────────────────────────────────── */

function renderOverview(artifact: PersonalizedArtifact | null, session: WorkspaceSession | null): void {
  const durationMs = artifact?.focusSummary?.totalDurationMs
    ?? (session && session.endTime ? session.endTime - session.startTime : 0);
  const resourcesCount = artifact?.resourcesUsed?.length ?? session?.tabs?.length ?? 0;
  const conceptsCount = artifact?.keyConcepts?.length ?? 0;
  const notesCount = artifact?.userNotes?.length ?? 0;
  const focusScore = artifact?.focusSummary?.focusScore
    ?? (session ? 0 : 0);

  const durationEl = $("ov-duration");
  if (durationEl) durationEl.textContent = fmtDuration(durationMs);

  const resourcesEl = $("ov-resources");
  if (resourcesEl) resourcesEl.textContent = String(resourcesCount);

  const conceptsEl = $("ov-concepts");
  if (conceptsEl) conceptsEl.textContent = String(conceptsCount);

  const notesEl = $("ov-notes");
  if (notesEl) notesEl.textContent = String(notesCount);

  const focusEl = $("ov-focus-score");
  if (focusEl) {
    const pctVal = Math.round(focusScore * 100);
    focusEl.textContent = `${pctVal}%`;
    focusEl.style.color = pctVal >= 80
      ? "var(--success)" : pctVal >= 50
        ? "var(--warning)" : "var(--danger)";
  }
}

/* ─── Section 2: Focus Visualization ───────────────────────────────────────── */

function renderFocus(session: WorkspaceSession | null, artifact: PersonalizedArtifact | null): void {
  if (!session) {
    $("foc-interruptions")!.textContent = "0";
    $("foc-passive-periods")!.textContent = "0";
    $("foc-longest-break")!.textContent = "--";
    $("foc-total-break")!.textContent = "--";
    return;
  }

  const interruptions = session.interruptionCount;
  const passivePeriods = session.stateTransitions.filter(t => t.toState === "passive").length;
  const longestBreak = session.longestDistractionMs;
  const totalBreak = session.totalPassiveDurationMs + session.totalSuspendedDurationMs;
  const totalDuration = session.endTime
    ? session.endTime - session.startTime
    : Date.now() - session.startTime;

  $("foc-interruptions")!.textContent = String(interruptions);
  $("foc-passive-periods")!.textContent = String(passivePeriods);
  $("foc-longest-break")!.textContent = fmtDurationShort(longestBreak);
  $("foc-total-break")!.textContent = fmtDurationShort(totalBreak);

  // Bar fills
  const maxInterruption = Math.max(1, session.tabs.length * 3);
  const interBar = $("foc-interruptions-bar");
  if (interBar) interBar.style.width = pct(Math.min(interruptions, maxInterruption), maxInterruption);

  const maxPassive = Math.max(1, session.tabs.length * 2);
  const passBar = $("foc-passive-bar");
  if (passBar) passBar.style.width = pct(Math.min(passivePeriods, maxPassive), maxPassive);

  const longestBar = $("foc-longest-bar");
  if (longestBar) longestBar.style.width = totalDuration > 0 ? pct(longestBreak, totalDuration) : "0%";

  const totalBar = $("foc-total-break-bar");
  if (totalBar) totalBar.style.width = totalDuration > 0 ? pct(totalBreak, totalDuration) : "0%";

  // Timeline canvas
  const canvas = $("focus-timeline-canvas") as HTMLCanvasElement | null;
  const startTime = session.startTime;
  const endTime = session.endTime ?? Date.now();
  drawFocusTimeline(canvas, session.stateTransitions, startTime, endTime);
}

/* ─── Section 3: Resource Breakdown ────────────────────────────────────────── */

function renderResources(artifact: PersonalizedArtifact | null, session: WorkspaceSession | null): void {
  const resources = artifact?.resourcesUsed ?? [];
  const catContainer = $("resource-categories");
  const tbody = $("resource-tbody");

  if (!catContainer || !tbody) return;

  // Category counts
  const cats: Record<string, number> = { pdf: 0, video: 0, website: 0, lecture: 0 };
  const catLabels: Record<string, string> = { pdf: "PDFs", video: "Videos", website: "Websites", lecture: "Lectures" };

  for (const r of resources) {
    const t = r.sourceType;
    if (cats[t] !== undefined) cats[t]++;
  }

  // Also count from session tabs if artifact has no resources
  if (resources.length === 0 && session?.tabs) {
    for (const t of session.tabs) {
      if (cats[t.sourceType] !== undefined) cats[t.sourceType]++;
    }
  }

  catContainer.innerHTML = Object.entries(cats)
    .map(([type, count]) => `
      <div class="resource-cat">
        <div class="resource-cat-value">${count}</div>
        <div class="resource-cat-label">${catLabels[type]}</div>
      </div>
    `).join("");

  // Table rows
  if (resources.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:var(--space-6)">No resource data available.</td></tr>`;
    return;
  }

  tbody.innerHTML = resources.map(r => `
    <tr>
      <td><span class="resource-title-cell" title="${esc(r.title || r.url)}">${sourceTypeIcon(r.sourceType)} ${esc(trunc(r.title || r.url, 40))}</span></td>
      <td><span class="resource-type-badge ${sourceTypeBadgeClass(r.sourceType)}">${r.sourceType}</span></td>
      <td>${fmtDurationShort(r.timeSpentMs)}</td>
      <td>${r.notesCount}</td>
      <td>${r.conceptsFound.slice(0, 3).map(c => esc(trunc(c, 15))).join(", ")}</td>
    </tr>
  `).join("");
}

/* ─── Section 4: What You Learned ──────────────────────────────────────────── */

function renderLearned(artifact: PersonalizedArtifact | null): void {
  const container = $("learned-cards");
  if (!container) return;

  const cards = artifact?.studyCards?.filter(c => !c.reviewFlag) ?? [];
  if (cards.length === 0) {
    container.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:var(--space-8);color:var(--text-dim);font-size:var(--font-size-sm)">No concepts recorded yet. Start studying to build your knowledge base.</p>`;
    return;
  }

  container.innerHTML = cards.map(c => `
    <div class="learned-card">
      <div class="lc-concept">${esc(c.concept)}</div>
      <div class="lc-content">${esc(c.content)}</div>
      <div class="lc-meta">
        <span>${c.format}</span>
      </div>
    </div>
  `).join("");
}

/* ─── Section 4b: Why MindEase Adapted This Content ────────────────────────── */

const CATEGORY_ICONS: Record<string, string> = {
  chunkSize: iconHTML("align-start-vertical"),
  simplification: iconHTML("book-open-text"),
  visualMode: iconHTML("image"),
  captionPacing: iconHTML("timer"),
  readingDensity: iconHTML("message-square"),
};

const CATEGORY_ICON_CLASSES: Record<string, string> = {
  chunkSize: "explanation-icon-cs",
  simplification: "explanation-icon-si",
  visualMode: "explanation-icon-vi",
  captionPacing: "explanation-icon-cp",
  readingDensity: "explanation-icon-rd",
};

async function renderExplanations(): Promise<void> {
  const container = $("explanations-list");
  if (!container) return;

  const explanations = await loadExplanations();
  const active = Object.values(explanations).filter((e): e is AdaptationExplanation => e !== null);

  if (active.length === 0) {
    container.innerHTML = `<div class="explanation-empty">No content adaptations were made yet. As you study, MindEase will adjust the content to match your needs and explain why.</div>`;
    return;
  }

  // Sort by timestamp descending (most recent first)
  active.sort((a, b) => b.timestamp - a.timestamp);

  container.innerHTML = active.map(e => {
    const icon = CATEGORY_ICONS[e.category] || iconHTML("message-circle");
    const iconClass = CATEGORY_ICON_CLASSES[e.category] || "";
    const time = new Date(e.timestamp).toLocaleString();
    return `
      <div class="explanation-card">
        <div class="explanation-header">
          <div>
            <span class="explanation-icon ${iconClass}">${icon}</span>
            <span class="explanation-title">${esc(e.title)}</span>
            <span class="explanation-action">${esc(e.actionLabel)}</span>
          </div>
        </div>
        <div class="explanation-body">${esc(e.explanation)}</div>
        <div class="explanation-meta">Adapted at ${time}</div>
      </div>
    `;
  }).join("");
}

/* ─── Section 5: Needs Review ──────────────────────────────────────────────── */

function renderReview(artifact: PersonalizedArtifact | null): void {
  const container = $("review-list");
  if (!container) return;

  const gaps = artifact?.needsReview ?? [];
  if (gaps.length === 0) {
    container.innerHTML = `<div class="review-empty">No gaps detected \u2014 great focus!</div>`;
    return;
  }

  container.innerHTML = gaps.map(g => `
    <div class="review-card">
      <div class="review-severity review-severity-${g.severity}"></div>
      <div class="review-body">
        <div class="review-concept">${esc(g.conceptLabel)}</div>
        <div class="review-text">${esc(trunc(g.text, 120))}</div>
        <span class="review-badge review-badge-${g.severity}">${g.severity}</span>
      </div>
    </div>
  `).join("");
}

/* ─── Section 6: Your Notes ────────────────────────────────────────────────── */

function renderNotes(artifact: PersonalizedArtifact | null, notes: HighlightNote[]): void {
  const container = $("notes-list");
  if (!container) return;

  const userNotes = artifact?.userNotes ?? notes;
  if (userNotes.length === 0) {
    container.innerHTML = `<div class="note-empty">No notes captured. Highlight text while studying to save notes.</div>`;
    return;
  }

  const recent = [...userNotes].reverse().slice(0, 20);
  const maxLen = 200;
  container.innerHTML = recent.map(n => {
    const cleaned = cleanNote(n.text);
    const displayText = cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "\u2026" : cleaned;
    return `
    <div class="note-card">
      <div class="note-text">\u201C${renderLatex(esc(displayText))}\u201D</div>
      <div class="note-meta">
        <span class="note-source">${esc(trunc(n.resourceTitle || n.sourceUrl, 35))}</span>
        <span>${new Date(n.timestamp).toLocaleString()}</span>
      </div>
    </div>`;
  }).join("");
}

/* ─── Section 7: Learning Insights ─────────────────────────────────────────── */

function renderInsights(artifact: PersonalizedArtifact | null): void {
  const container = $("insights-grid");
  if (!container) return;

  const concepts = artifact?.keyConcepts ?? [];
  const connections = artifact?.connections ?? [];
  const crossSource = artifact?.crossSourceConnections ?? [];
  const learnedCards = artifact?.learnedCards ?? [];
  const allCards = artifact?.studyCards ?? [];

  const topConcepts = concepts.slice(0, 6);
  const topEngaged = learnedCards.length;
  const needReview = artifact?.needsReview?.length ?? 0;
  const crossConnections = connections.length;

  let html = "";

  // Concept engagement card
  if (topConcepts.length > 0) {
    html += `
      <div class="insight-card">
        <div class="insight-header">
          <span class="insight-icon">${iconHTML("brain")}</span>
          <span class="insight-title">Top Concepts</span>
        </div>
        <div class="insight-body">
          ${topConcepts.map(c => {
            const pctVal = Math.round(c.engagementScore * 100);
            return `
              <div class="insight-stat">
                <span class="insight-stat-label">${esc(trunc(c.label, 22))}</span>
                <span class="insight-stat-value" style="color:${pctVal >= 60 ? "var(--success)" : pctVal >= 30 ? "var(--warning)" : "var(--danger)"}">${pctVal}%</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  // Learning stats
  html += `
    <div class="insight-card">
      <div class="insight-header">
        <span class="insight-icon">${iconHTML("bar-chart-3")}</span>
        <span class="insight-title">Learning Stats</span>
      </div>
      <div class="insight-body">
        <div class="insight-stat"><span class="insight-stat-label">Engaged Concepts</span><span class="insight-stat-value">${topEngaged}</span></div>
        <div class="insight-stat"><span class="insight-stat-label">Need Review</span><span class="insight-stat-value" style="color:${needReview > 0 ? "var(--warning)" : "var(--success)"}">${needReview}</span></div>
        <div class="insight-stat"><span class="insight-stat-label">Cross-Connections</span><span class="insight-stat-value">${crossConnections}</span></div>
        <div class="insight-stat"><span class="insight-stat-label">Study Cards</span><span class="insight-stat-value">${allCards.length}</span></div>
      </div>
    </div>
  `;

  // Cross-source connections
  const displayConnections = crossSource.length > 0 ? crossSource : connections;
  if (displayConnections.length > 0) {
    html += `
      <div class="insight-card insight-card-wide">
        <div class="insight-header">
          <span class="insight-icon">${iconHTML("link")}</span>
          <span class="insight-title">Cross-Source Connections (${displayConnections.length})</span>
        </div>
        <div class="insight-body">
          ${displayConnections.slice(0, 4).map(c => {
            const resources = "resources" in c
              ? (c as CrossSourceConnection).resources
              : null;
            return `
              <div style="margin-bottom:var(--space-4);padding-bottom:var(--space-3);border-bottom:1px solid var(--border)">
                <div style="font-weight:700;font-size:var(--font-size-md);color:var(--accent);margin-bottom:var(--space-2)">
                  ${esc(c.conceptLabel)}
                </div>
                ${resources
                  ? resources.map(r => `
                    <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0;font-size:var(--font-size-sm)">
                      <span class="resource-type-badge resource-type-${r.type.toLowerCase()}">${esc(r.type)}</span>
                      <span class="insight-stat-label" title="${esc(r.title)}">${esc(trunc(r.title, 30))}</span>
                    </div>
                  `).join("")
                  : `<div style="font-size:var(--font-size-xs);color:var(--text-dim)">
                      ${"sourceIds" in c ? c.sourceIds.length : c.matchCount} source(s)
                    </div>`
                }
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  // Engagement distribution
  const engagedCount = allCards.length - needReview;
  const reviewCount = needReview;
  const totalStudy = Math.max(1, allCards.length);
  html += `
    <div class="insight-card">
      <div class="insight-header">
        <span class="insight-icon">${iconHTML("target")}</span>
        <span class="insight-title">Engagement Balance</span>
      </div>
      <div class="insight-body">
        <div style="margin-bottom:var(--space-3)">
          <div style="display:flex;justify-content:space-between;font-size:var(--font-size-sm)">
            <span>Mastered</span>
            <span style="font-weight:600;color:var(--success)">${pct(engagedCount, totalStudy)}</span>
          </div>
          <div class="fm-bar" style="margin-top:var(--space-1)"><div class="fm-bar-fill" style="width:${pct(engagedCount, totalStudy)};background:var(--success)"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:var(--font-size-sm)">
            <span>Needs Review</span>
            <span style="font-weight:600;color:var(--warning)">${pct(reviewCount, totalStudy)}</span>
          </div>
          <div class="fm-bar" style="margin-top:var(--space-1)"><div class="fm-bar-fill" style="width:${pct(reviewCount, totalStudy)};background:var(--warning)"></div></div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/* ─── Section 8: Progress Summary ──────────────────────────────────────────── */

function renderProgress(artifact: PersonalizedArtifact | null, session: WorkspaceSession | null, profile: FullCognitiveProfile | null): void {
  const container = $("progress-summary");
  if (!container) return;

  const sessionCount = profile?.rlState?.sessionCount ?? 1;
  const totalCards = artifact?.studyCards?.length ?? 0;
  const totalConcepts = artifact?.keyConcepts?.length ?? 0;
  const totalNotes = artifact?.userNotes?.length ?? 0;
  const focusScore = artifact?.focusSummary?.focusScore ?? 0;

  let html = `
    <div class="progress-grid">
      <div class="progress-card">
        <div class="progress-card-value">${sessionCount}</div>
        <div class="progress-card-label">Sessions</div>
      </div>
      <div class="progress-card">
        <div class="progress-card-value">${totalCards}</div>
        <div class="progress-card-label">Study Cards</div>
      </div>
      <div class="progress-card">
        <div class="progress-card-value">${totalConcepts}</div>
        <div class="progress-card-label">Concepts</div>
      </div>
      <div class="progress-card">
        <div class="progress-card-value">${totalNotes}</div>
        <div class="progress-card-label">Notes</div>
      </div>
    </div>
  `;

  if (profile) {
    const b = profile.baseline;
    html += `
      <div class="progress-profile-section">
        <div style="font-weight:700;font-size:var(--font-size-md)">Cognitive Profile</div>
        <div class="profile-detail-grid">
          <div class="profile-detail-item">
            <span class="pd-label">Format</span>
            <span class="pd-value">${esc(b.formatPreference)}</span>
          </div>
          <div class="profile-detail-item">
            <span class="pd-label">Attention</span>
            <span class="pd-value">${esc(b.attentionSpan)}</span>
          </div>
          <div class="profile-detail-item">
            <span class="pd-label">Reading Pace</span>
            <span class="pd-value">${esc(b.readingPace)}</span>
          </div>
          <div class="profile-detail-item">
            <span class="pd-label">Info Density</span>
            <span class="pd-value">${esc(b.infoDensity)}</span>
          </div>
          <div class="profile-detail-item">
            <span class="pd-label">Learning Approach</span>
            <span class="pd-value">${esc(b.learningApproach)}</span>
          </div>
          <div class="profile-detail-item">
            <span class="pd-label">Focus Score</span>
            <span class="pd-value" style="color:${focusScore >= 0.8 ? "var(--success)" : focusScore >= 0.5 ? "var(--warning)" : "var(--danger)"}">${Math.round(focusScore * 100)}%</span>
          </div>
        </div>
      </div>
    `;
  }

  // Session info
  if (session) {
    const sessionId = session.sessionId.slice(0, 8);
    html += `
      <div style="margin-top:var(--space-4);font-size:var(--font-size-xs);color:var(--text-muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2)">
        <span>Session: ${esc(sessionId)}...</span>
        <span>Started: ${new Date(session.startTime).toLocaleString()}</span>
        ${session.endTime ? `<span>Ended: ${new Date(session.endTime).toLocaleString()}</span>` : ""}
      </div>
    `;
  }

  container.innerHTML = html;
}

/* ─── Main Load ────────────────────────────────────────────────────────────── */

async function loadDashboard(): Promise<void> {
  try {
    const data = await loadData();

    // Hide loading, show dashboard
    const loading = $("loading-screen");
    const dashboard = $("dashboard");
    if (loading) loading.style.display = "none";
    if (dashboard) dashboard.style.display = "block";

    // Update footer
    const footerEl = $("footer-session");
    if (footerEl && data.session) {
      footerEl.textContent = `Session: ${data.session.sessionId.slice(0, 8)}...`;
    }

    // Render all sections
    renderOverview(data.artifact, data.session);
    renderFocus(data.session, data.artifact);
    renderResources(data.artifact, data.session);
    renderLearned(data.artifact);
    await renderExplanations();
    renderReview(data.artifact);
    renderNotes(data.artifact, data.notes);
    renderInsights(data.artifact);
    renderProgress(data.artifact, data.session, data.profile);

    // Redraw canvas on resize
    const canvas = $("focus-timeline-canvas") as HTMLCanvasElement | null;
    const resizeHandler = () => {
      if (data.session) {
        const start = data.session.startTime;
        const end = data.session.endTime ?? Date.now();
        drawFocusTimeline(canvas, data.session.stateTransitions, start, end);
      }
    };
    window.addEventListener("resize", resizeHandler);
  } catch (err) {
    console.error("[Dashboard] Failed to load:", err);
    const loading = $("loading-screen");
    if (loading) {
      loading.innerHTML = `
        <div style="color:var(--danger);font-size:1.2rem">${iconHTML("alert-triangle")}</div>
        <div style="color:var(--text-dim)">Failed to load session data.</div>
        <button onclick="location.reload()" style="margin-top:16px;padding:8px 20px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit">Retry</button>
      `;
    }
  }
}

/* ─── Start ────────────────────────────────────────────────────────────────── */

init();
