import { useEffect, useState, useRef, useCallback, type FC } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/theme.css";
import "./dashboard.css";
import browser from "webextension-polyfill";
import {
  applyTheme, toggleTheme as themeManagerToggle,
  getAppliedTheme, type Theme,
} from "@/utils/themeManager";
import { STORAGE_KEYS } from "@/types";
import type {
  WorkspaceSession, FullCognitiveProfile, PersonalizedArtifact,
  ResourceEntry, KeyConceptEntry, StudyCard, Gap,
  Connection, TabResource, FocusSummary, StateTransition,
  SessionState, AdaptationExplanation,
  CrossSourceConnection, VisualEntry,
} from "@/types";
import { loadExplanations } from "@/layer2/explainer";
import {
  Brain, BarChart3, Timer, FolderOpen, FileText, Target,
  TrendingUp, Package, BookOpen, MessageCircle, RefreshCw,
  Image, Lightbulb, FileDown, Sun, Moon, X,
  AlertTriangle, Link, AlignStartVertical, BookOpenText,
  MessageSquare, Film, Globe, GraduationCap,
  LayoutDashboard, Eye, ChartNoAxesColumn,
} from "lucide-react";

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

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

function esc(text: string | number | undefined | null): string {
  if (text == null) return "";
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(String(text)));
  return div.innerHTML;
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "\u2026";
}

const SOURCE_TYPE_ICONS: Record<string, FC<{ size?: number }>> = {
  pdf: () => <FileText size={14} />,
  video: () => <Film size={14} />,
  website: () => <Globe size={14} />,
  lecture: () => <GraduationCap size={14} />,
};

const DEFAULT_ICON = () => <FolderOpen size={14} />;

function sourceTypeIcon(type: string): React.ReactNode {
  const Icon = SOURCE_TYPE_ICONS[type] || DEFAULT_ICON;
  return <Icon />;
}

/* ─── Data Loading ─────────────────────────────────────────────────────────── */

interface DashboardData {
  session: WorkspaceSession | null;
  artifact: PersonalizedArtifact | null;
  profile: FullCognitiveProfile | null;
  visuals: VisualEntry[];
}

async function loadData(): Promise<DashboardData> {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.WORKSPACE,
    "latestArtifact",
    STORAGE_KEYS.PROFILE,
    STORAGE_KEYS.VISUALS_CACHE,
  ]);

  const session = result[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | null;
  const artifact = result["latestArtifact"] as PersonalizedArtifact | null;
  const profile = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | null;
  const visualsCache = result[STORAGE_KEYS.VISUALS_CACHE] as { entries: VisualEntry[]; updatedAt: number } | null;

  return {
    session,
    artifact,
    profile,
    visuals: visualsCache?.entries ?? [],
  };
}

/* ─── Canvas Focus Timeline ────────────────────────────────────────────────── */

function drawFocusTimeline(
  canvas: HTMLCanvasElement | null,
  transitions: StateTransition[],
  startTime: number,
  endTime: number,
): void {
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
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#7286D3";
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const barY = 8;
  const barH = h - 16;
  const barR = 4;

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-surface-alt").trim() || "#20254A";
  ctx.beginPath();
  ctx.roundRect(0, barY, w, barH, barR);
  ctx.fill();

  if (!transitions || transitions.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--success").trim() || "#4ade80";
    ctx.beginPath();
    ctx.roundRect(2, barY + 2, w - 4, barH - 4, barR - 1);
    ctx.fill();
    return;
  }

  const sorted = [...transitions].sort((a, b) => a.timestamp - b.timestamp);
  const style = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {
    active: style.getPropertyValue("--success").trim() || "#4ade80",
    passive: style.getPropertyValue("--warning").trim() || "#facc15",
    suspended: style.getPropertyValue("--danger").trim() || "#f87171",
  };

  let currentState: SessionState = "active";
  let segmentStart = startTime;

  for (const t of sorted) {
    const segStartX = ((segmentStart - startTime) / duration) * w;
    const segEndX = ((t.timestamp - startTime) / duration) * w;
    const segW = Math.max(2, segEndX - segStartX);

    ctx.fillStyle = colors[currentState] || "#B8B8E0";
    ctx.beginPath();
    ctx.roundRect(segStartX, barY + 2, segW, barH - 4, 2);
    ctx.fill();

    currentState = t.toState;
    segmentStart = t.timestamp;
  }

  const lastStartX = ((segmentStart - startTime) / duration) * w;
  const lastW = Math.max(2, w - lastStartX);
  ctx.fillStyle = colors[currentState] || "#B8B8E0";
  ctx.beginPath();
  ctx.roundRect(lastStartX, barY + 2, lastW, barH - 4, 2);
  ctx.fill();
}

/* ─── Sidebar ──────────────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "focus", label: "Focus", icon: Eye },
  { id: "resources", label: "Resources", icon: FolderOpen },
  { id: "learned", label: "Learned", icon: BookOpen },
  { id: "explanations", label: "Explanations", icon: MessageCircle },
  { id: "review", label: "Review", icon: RefreshCw },
  { id: "visuals", label: "Visuals", icon: Image },
  { id: "notes", label: "Notes", icon: FileText },
  { id: "insights", label: "Insights", icon: Lightbulb },
  { id: "progress", label: "Progress", icon: ChartNoAxesColumn },
];

interface SidebarProps {
  activeSection: string;
  onNavigate: (id: string) => void;
  theme: Theme;
  onThemeToggle: () => void;
  onExport: () => void;
  onClose: () => void;
}

const Sidebar: FC<SidebarProps> = ({ activeSection, onNavigate, theme, onThemeToggle, onExport, onClose }) => (
  <aside className="dash-sidebar">
    <div className="sidebar-brand">
      <div className="sidebar-brand-icon">
        <Brain size={18} />
      </div>
      <div>
        <div className="sidebar-brand-text">MindEase</div>
        <div className="sidebar-brand-sub">Dashboard</div>
      </div>
    </div>

    <nav className="sidebar-nav">
      {NAV_ITEMS.map(item => (
        <button
          key={item.id}
          className={`sidebar-nav-item${activeSection === item.id ? " active" : ""}`}
          onClick={() => onNavigate(item.id)}
          aria-label={item.label}
        >
          <item.icon size={16} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>

    <div className="sidebar-footer">
      <button className="sidebar-footer-btn" onClick={onThemeToggle} aria-label="Toggle theme">
        {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
      </button>
      <button className="sidebar-footer-btn" onClick={onExport} aria-label="Export as PDF">
        <FileDown size={14} />
        <span>Export PDF</span>
      </button>
      <button className="sidebar-footer-btn" onClick={onClose} aria-label="Close dashboard">
        <X size={14} />
        <span>Close</span>
      </button>
    </div>
  </aside>
);

/* ─── Section Components ───────────────────────────────────────────────────── */

const SectionOverview: FC<{ artifact: PersonalizedArtifact | null; session: WorkspaceSession | null }> = ({ artifact, session }) => {
  const durationMs = artifact?.focusSummary?.totalDurationMs
    ?? (session && session.endTime ? session.endTime - session.startTime : 0);
  const resourcesCount = artifact?.resourcesUsed?.length ?? session?.tabs?.length ?? 0;
  const conceptsCount = artifact?.keyConcepts?.length ?? 0;
  const notesCount = artifact?.userNotes?.length ?? 0;
  const focusScore = artifact?.focusSummary?.focusScore ?? 0;
  const pctVal = Math.round(focusScore * 100);

  return (
    <section className="section-card" id="section-overview" data-section="overview">
      <div className="section-card-header">
        <BarChart3 size={16} />
        <h2>Session Overview</h2>
      </div>
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-value">{fmtDuration(durationMs)}</span>
          <span className="stat-label">Duration</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{resourcesCount}</span>
          <span className="stat-label">Resources Used</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{conceptsCount}</span>
          <span className="stat-label">Concepts Explored</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{notesCount}</span>
          <span className="stat-label">Notes Captured</span>
        </div>
        <div className="stat-card stat-card-accent">
          <span className="stat-value stat-value-accent">{pctVal}%</span>
          <span className="stat-label">Focus Score</span>
          <span className={`stat-trend ${pctVal >= 60 ? "stat-trend-up" : "stat-trend-down"}`}>
            {pctVal >= 60 ? <TrendingUp size={12} /> : <TrendingUp size={12} style={{ transform: "rotate(180deg)" }} />}
            {pctVal >= 60 ? "Good" : "Needs attention"}
          </span>
        </div>
      </div>
    </section>
  );
};

const FocusTimelineCanvas: FC<{ session: WorkspaceSession | null }> = ({ session }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!session) return;
    const start = session.startTime;
    const end = session.endTime ?? Date.now();
    drawFocusTimeline(canvasRef.current, session.stateTransitions, start, end);

    const handler = () => {
      drawFocusTimeline(canvasRef.current, session.stateTransitions, start, end);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [session]);

  return (
    <div className="timeline-wrap">
      <canvas ref={canvasRef} width={800} height={60} />
    </div>
  );
};

const SectionFocus: FC<{ session: WorkspaceSession | null; artifact: PersonalizedArtifact | null }> = ({ session, artifact }) => {
  if (!session) {
    return (
      <section className="section-card" id="section-focus" data-section="focus">
        <div className="section-card-header">
          <Eye size={16} />
          <h2>Focus Visualization</h2>
        </div>
        <FocusTimelineCanvas session={null} />
        <div className="focus-metrics">
          <div className="focus-metric"><span className="fm-value">0</span><span className="fm-label">Interruptions</span><div className="fm-bar"><div className="fm-fill" style={{ width: "0%", background: "var(--success)" }} /></div></div>
          <div className="focus-metric"><span className="fm-value">0</span><span className="fm-label">Passive Periods</span><div className="fm-bar"><div className="fm-fill" style={{ width: "0%", background: "var(--warning)" }} /></div></div>
          <div className="focus-metric"><span className="fm-value">--</span><span className="fm-label">Longest Break</span><div className="fm-bar"><div className="fm-fill" style={{ width: "0%", background: "var(--danger)" }} /></div></div>
        </div>
      </section>
    );
  }

  const interruptions = session.interruptionCount;
  const passivePeriods = session.stateTransitions.filter(t => t.toState === "passive").length;
  const longestBreak = session.longestDistractionMs;
  const totalBreak = session.totalPassiveDurationMs + session.totalSuspendedDurationMs;
  const totalDuration = session.endTime ? session.endTime - session.startTime : Date.now() - session.startTime;
  const maxInterruption = Math.max(1, session.tabs.length * 3);
  const maxPassive = Math.max(1, session.tabs.length * 2);

  const focusScore = artifact?.focusSummary?.focusScore ?? session.interruptionCount > 0 ? Math.max(0, 1 - (totalBreak / Math.max(1, totalDuration))) : 1;

  return (
    <section className="section-card" id="section-focus" data-section="focus">
      <div className="section-card-header">
        <Eye size={16} />
        <h2>Focus Visualization</h2>
      </div>
      <div className="content-grid-2">
        <div>
          <FocusTimelineCanvas session={session} />
          <div className="timeline-legend">
            <span className="legend-item"><span className="legend-dot legend-active" /> Active</span>
            <span className="legend-item"><span className="legend-dot legend-passive" /> Passive</span>
            <span className="legend-item"><span className="legend-dot legend-suspended" /> Suspended</span>
          </div>
        </div>
        <div className="focus-metrics">
          <div className="section-card-header" style={{ marginBottom: 12 }}>
            <BarChart3 size={14} />
            <h2>Focus Metrics</h2>
          </div>
          <div className="focus-metric">
            <span className="fm-value">{interruptions}</span>
            <span className="fm-label">Interruptions</span>
            <div className="fm-bar"><div className="fm-fill" style={{ width: pct(Math.min(interruptions, maxInterruption), maxInterruption), background: "var(--danger)" }} /></div>
          </div>
          <div className="focus-metric">
            <span className="fm-value">{passivePeriods}</span>
            <span className="fm-label">Passive Periods</span>
            <div className="fm-bar"><div className="fm-fill" style={{ width: pct(Math.min(passivePeriods, maxPassive), maxPassive), background: "var(--warning)" }} /></div>
          </div>
          <div className="focus-metric">
            <span className="fm-value">{fmtDurationShort(longestBreak)}</span>
            <span className="fm-label">Longest Break</span>
            <div className="fm-bar"><div className="fm-fill" style={{ width: totalDuration > 0 ? pct(longestBreak, totalDuration) : "0%", background: "var(--info)" }} /></div>
          </div>
          <div className="focus-metric">
            <span className="fm-value">{fmtDurationShort(totalBreak)}</span>
            <span className="fm-label">Total Break Time</span>
            <div className="fm-bar"><div className="fm-fill" style={{ width: totalDuration > 0 ? pct(totalBreak, totalDuration) : "0%", background: "var(--danger)" }} /></div>
          </div>
          <div className="focus-metric">
            <span className="fm-value">{Math.round(focusScore * 100)}%</span>
            <span className="fm-label">Focus Score</span>
            <div className="fm-bar"><div className="fm-fill" style={{ width: pct(Math.round(focusScore * 100), 100), background: focusScore >= 0.6 ? "var(--success)" : "var(--warning)" }} /></div>
          </div>
        </div>
      </div>
    </section>
  );
};

const SectionResources: FC<{ artifact: PersonalizedArtifact | null; session: WorkspaceSession | null }> = ({ artifact, session }) => {
  const resources = artifact?.resourcesUsed ?? [];
  const cats: Record<string, number> = { pdf: 0, video: 0, website: 0, lecture: 0 };
  const catLabels: Record<string, string> = { pdf: "PDFs", video: "Videos", website: "Websites", lecture: "Lectures" };

  for (const r of resources) {
    if (cats[r.sourceType] !== undefined) cats[r.sourceType]++;
  }

  if (resources.length === 0 && session?.tabs) {
    for (const t of session.tabs) {
      if (cats[t.sourceType] !== undefined) cats[t.sourceType]++;
    }
  }

  return (
    <section className="section-card" id="section-resources" data-section="resources">
      <div className="section-card-header">
        <FolderOpen size={16} />
        <h2>Resource Breakdown</h2>
      </div>
      <div className="resource-chips">
        {Object.entries(cats).map(([type, count]) => (
          <div className="resource-chip" key={type}>
            <div className="resource-chip-value">{count}</div>
            <div className="resource-chip-label">{catLabels[type]}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="resource-table">
          <thead>
            <tr><th>Resource</th><th>Type</th><th>Time</th><th>Notes</th><th>Concepts</th></tr>
          </thead>
          <tbody>
            {resources.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "var(--space-6)" }}>No resource data available.</td></tr>
            ) : (
              resources.map((r, i) => (
                <tr key={i}>
                  <td><span className="resource-title-cell" title={r.title || r.url}>{sourceTypeIcon(r.sourceType)} {trunc(r.title || r.url, 40)}</span></td>
                  <td><span className={`resource-badge resource-badge-${r.sourceType}`}>{r.sourceType}</span></td>
                  <td>{fmtDurationShort(r.timeSpentMs)}</td>
                  <td>{r.notesCount}</td>
                  <td>{r.conceptsFound.slice(0, 3).map(c => trunc(c, 15)).join(", ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const SectionLearned: FC<{ artifact: PersonalizedArtifact | null }> = ({ artifact }) => {
  const cards = artifact?.studyCards?.filter(c => !c.reviewFlag) ?? [];

  return (
    <section className="section-card" id="section-learned" data-section="learned">
      <div className="section-card-header">
        <BookOpen size={16} />
        <h2>What You Learned</h2>
      </div>
      {cards.length === 0 ? (
        <div className="empty-state">No concepts recorded yet. Start studying to build your knowledge base.</div>
      ) : (
        <div className="learned-grid">
          {cards.map((c, i) => (
            <div className="learned-item" key={i}>
              <div className="li-concept">{c.concept}</div>
              <div className="li-content">{c.content}</div>
              <span className="li-format">{c.format}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const SectionExplanations: FC = () => {
  const [explanations, setExplanations] = useState<AdaptationExplanation[]>([]);

  useEffect(() => {
    loadExplanations().then(exps => {
      const active = Object.values(exps).filter((e): e is AdaptationExplanation => e !== null);
      active.sort((a, b) => b.timestamp - a.timestamp);
      setExplanations(active);
    }).catch(() => {});
  }, []);

  const CATEGORY_ICONS: Record<string, FC<{ size?: number }>> = {
    chunkSize: () => <AlignStartVertical size={18} />,
    simplification: () => <BookOpenText size={18} />,
    visualMode: () => <Image size={18} />,
    captionPacing: () => <Timer size={18} />,
    readingDensity: () => <MessageSquare size={18} />,
  };

  const CATEGORY_ICON_CLASSES: Record<string, string> = {
    chunkSize: "explain-icon-cs",
    simplification: "explain-icon-si",
    visualMode: "explain-icon-vi",
    captionPacing: "explain-icon-cp",
    readingDensity: "explain-icon-rd",
  };

  return (
    <section className="section-card" id="section-explanations" data-section="explanations">
      <div className="section-card-header">
        <MessageCircle size={16} />
        <h2>Why MindEase Adapted This Content</h2>
      </div>
      <div className="explanations-list">
        {explanations.length === 0 ? (
          <div className="explain-empty">No content adaptations were made yet. As you study, MindEase will adjust the content to match your needs and explain why.</div>
        ) : (
          explanations.map((e, i) => {
            const Icon = CATEGORY_ICONS[e.category] || MessageCircle;
            const iconClass = CATEGORY_ICON_CLASSES[e.category] || "";
            return (
              <div className="explain-item" key={i}>
                <div className="explain-header">
                  <span className={`explain-icon ${iconClass}`}><Icon size={18} /></span>
                  <span className="explain-title">{e.title}</span>
                  <span className="explain-action">{e.actionLabel}</span>
                </div>
                <div className="explain-body">{e.explanation}</div>
                <div className="explain-meta">Adapted at {new Date(e.timestamp).toLocaleString()}</div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

const SectionReview: FC<{ artifact: PersonalizedArtifact | null }> = ({ artifact }) => {
  const gaps = artifact?.needsReview ?? [];

  return (
    <section className="section-card" id="section-review" data-section="review">
      <div className="section-card-header">
        <RefreshCw size={16} />
        <h2>Needs Review</h2>
      </div>
      {gaps.length === 0 ? (
        <div className="review-empty">No gaps detected &mdash; great focus!</div>
      ) : (
        <div className="review-list">
          {gaps.map((g, i) => (
            <div className="review-item" key={i}>
              <div className={`review-severity review-severity-${g.severity}`} />
              <div className="review-body">
                <div className="review-concept">{g.conceptLabel}</div>
                <div className="review-text">{trunc(g.text, 120)}</div>
                <span className={`review-badge review-badge-${g.severity}`}>{g.severity}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const SectionVisuals: FC<{ visuals: VisualEntry[] }> = ({ visuals }) => (
  <section className="section-card" id="section-visuals" data-section="visuals">
    <div className="section-card-header">
      <Image size={16} />
      <h2>Generated Visuals</h2>
    </div>
    {visuals.length === 0 ? (
      <div className="visuals-placeholder">No visuals were generated during this session.</div>
    ) : (
      <div className="visuals-grid">
        {visuals.map((v, i) => (
          <div className="visual-card" key={i}>
            <img
              src={v.dataUrl}
              alt={v.concept}
              loading="lazy"
              style={{ aspectRatio: `${v.width ?? 800}/${v.height ?? 600}` }}
            />
            <div className="visual-card-footer">
              <span>{v.concept}</span>
              <span className="visual-card-source">Napkin</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);

const SectionInsights: FC<{ artifact: PersonalizedArtifact | null }> = ({ artifact }) => {
  const concepts = artifact?.keyConcepts ?? [];
  const connections = artifact?.connections ?? [];
  const crossSource = artifact?.crossSourceConnections ?? [];
  const learnedCards = artifact?.learnedCards ?? [];
  const allCards = artifact?.studyCards ?? [];
  const needReview = artifact?.needsReview?.length ?? 0;
  const topConcepts = concepts.slice(0, 6);
  const topEngaged = learnedCards.length;
  const crossConnections = connections.length;
  const displayConnections = crossSource.length > 0 ? crossSource : connections;
  const engagedCount = allCards.length - needReview;
  const totalStudy = Math.max(1, allCards.length);

  return (
    <section className="section-card" id="section-insights" data-section="insights">
      <div className="section-card-header">
        <Lightbulb size={16} />
        <h2>Learning Insights</h2>
      </div>
      <div className="insight-grid">
        {topConcepts.length > 0 && (
          <div className="insight-card">
            <div className="insight-header">
              <Brain size={16} />
              <span className="insight-title">Top Concepts</span>
            </div>
            <div>
              {topConcepts.map((c, i) => {
                const pctVal = Math.round(c.engagementScore * 100);
                return (
                  <div className="insight-stat" key={i}>
                    <span className="insight-stat-label">{trunc(c.label, 22)}</span>
                    <span className="insight-stat-value" style={{ color: pctVal >= 60 ? "var(--success)" : pctVal >= 30 ? "var(--warning)" : "var(--danger)" }}>{pctVal}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="insight-card">
          <div className="insight-header">
            <BarChart3 size={16} />
            <span className="insight-title">Learning Stats</span>
          </div>
          <div>
            <div className="insight-stat"><span className="insight-stat-label">Engaged Concepts</span><span className="insight-stat-value">{topEngaged}</span></div>
            <div className="insight-stat"><span className="insight-stat-label">Need Review</span><span className="insight-stat-value" style={{ color: needReview > 0 ? "var(--warning)" : "var(--success)" }}>{needReview}</span></div>
            <div className="insight-stat"><span className="insight-stat-label">Cross-Connections</span><span className="insight-stat-value">{crossConnections}</span></div>
            <div className="insight-stat"><span className="insight-stat-label">Study Cards</span><span className="insight-stat-value">{allCards.length}</span></div>
          </div>
        </div>

        <div className="insight-card">
          <div className="insight-header">
            <Target size={16} />
            <span className="insight-title">Engagement Balance</span>
          </div>
          <div>
            <div style={{ marginBottom: "var(--space-3)" }}>
              <div className="insight-stat">
                <span className="insight-stat-label">Mastered</span>
                <span className="insight-stat-value" style={{ color: "var(--success)" }}>{pct(engagedCount, totalStudy)}</span>
              </div>
              <div className="fm-bar" style={{ marginTop: 6 }}><div className="fm-fill" style={{ width: pct(engagedCount, totalStudy), background: "var(--success)" }} /></div>
            </div>
            <div>
              <div className="insight-stat">
                <span className="insight-stat-label">Needs Review</span>
                <span className="insight-stat-value" style={{ color: "var(--warning)" }}>{pct(needReview, totalStudy)}</span>
              </div>
              <div className="fm-bar" style={{ marginTop: 6 }}><div className="fm-fill" style={{ width: pct(needReview, totalStudy), background: "var(--warning)" }} /></div>
            </div>
          </div>
        </div>
      </div>

      {displayConnections.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="insight-header" style={{ marginBottom: 12 }}>
            <Link size={14} />
            <span className="insight-title">Cross-Source Connections ({displayConnections.length})</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {displayConnections.slice(0, 4).map((c, i) => {
              const resources = "resources" in c ? (c as CrossSourceConnection).resources : null;
              return (
                <div key={i} style={{ flex: "1 1 240px", background: "var(--bg-surface-alt)", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--accent)", marginBottom: 8 }}>{c.conceptLabel}</div>
                  {resources
                    ? resources.map((r, j) => (
                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: "0.72rem" }}>
                        <span className={`resource-badge resource-badge-${r.type.toLowerCase()}`}>{r.type}</span>
                        <span style={{ color: "var(--text-dim)" }} title={r.title}>{trunc(r.title, 25)}</span>
                      </div>
                    ))
                    : <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                        {"sourceIds" in c ? c.sourceIds.length : c.matchCount} source(s)
                      </div>
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

const SectionProgress: FC<{ artifact: PersonalizedArtifact | null; session: WorkspaceSession | null; profile: FullCognitiveProfile | null }> = ({ artifact, session, profile }) => {
  const sessionCount = profile?.rlState?.sessionCount ?? 1;
  const totalCards = artifact?.studyCards?.length ?? 0;
  const totalConcepts = artifact?.keyConcepts?.length ?? 0;
  const totalNotes = artifact?.userNotes?.length ?? 0;
  const focusScore = artifact?.focusSummary?.focusScore ?? 0;

  return (
    <section className="section-card" id="section-progress" data-section="progress">
      <div className="section-card-header">
        <ChartNoAxesColumn size={16} />
        <h2>Progress Summary</h2>
      </div>
      <div className="progress-grid">
        <div className="progress-card">
          <div className="progress-card-value">{sessionCount}</div>
          <div className="progress-card-label">Sessions</div>
        </div>
        <div className="progress-card">
          <div className="progress-card-value">{totalCards}</div>
          <div className="progress-card-label">Study Cards</div>
        </div>
        <div className="progress-card">
          <div className="progress-card-value">{totalConcepts}</div>
          <div className="progress-card-label">Concepts</div>
        </div>
        <div className="progress-card">
          <div className="progress-card-value">{totalNotes}</div>
          <div className="progress-card-label">Notes</div>
        </div>
      </div>

      {profile && (
        <div className="profile-section">
          <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>Cognitive Profile</div>
          <div className="profile-grid">
            <div className="profile-item">
              <span className="pi-label">Format</span>
              <span className="pi-value">{profile.baseline.formatPreference}</span>
            </div>
            <div className="profile-item">
              <span className="pi-label">Attention</span>
              <span className="pi-value">{profile.baseline.attentionSpan}</span>
            </div>
            <div className="profile-item">
              <span className="pi-label">Reading Pace</span>
              <span className="pi-value">{profile.baseline.readingPace}</span>
            </div>
            <div className="profile-item">
              <span className="pi-label">Info Density</span>
              <span className="pi-value">{profile.baseline.infoDensity}</span>
            </div>
            <div className="profile-item">
              <span className="pi-label">Learning Approach</span>
              <span className="pi-value">{profile.baseline.learningApproach}</span>
            </div>
            <div className="profile-item">
              <span className="pi-label">Focus Score</span>
              <span className="pi-value" style={{ color: focusScore >= 0.8 ? "var(--success)" : focusScore >= 0.5 ? "var(--warning)" : "var(--danger)" }}>{Math.round(focusScore * 100)}%</span>
            </div>
          </div>
        </div>
      )}

      {session && (
        <div className="session-info">
          <span>Session: {session.sessionId.slice(0, 8)}...</span>
          <span>Started: {new Date(session.startTime).toLocaleString()}</span>
          {session.endTime && <span>Ended: {new Date(session.endTime).toLocaleString()}</span>}
        </div>
      )}
    </section>
  );
};

/* ─── Main Dashboard Component ─────────────────────────────────────────────── */

const Dashboard: FC = () => {
  const [theme, setTheme] = useState<Theme>("light");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const sectionRefs = useRef<Map<string, IntersectionObserverEntry>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme("light");
    loadData().then(d => {
      setData(d);
      setLoading(false);
    }).catch(() => {
      setError(true);
      setLoading(false);
    });

    if (!document.getElementById("mindease-katex-css")) {
      const link = document.createElement("link");
      link.id = "mindease-katex-css";
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (loading || !data) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const section = entry.target.getAttribute("data-section");
          if (section) {
            sectionRefs.current.set(section, entry);
          }
        }

        // find the topmost visible section
        let bestSection = "overview";
        let bestTop = Infinity;
        for (const [id, entry] of sectionRefs.current.entries()) {
          if (entry.isIntersecting && entry.boundingClientRect.top < bestTop) {
            bestTop = entry.boundingClientRect.top;
            bestSection = id;
          }
        }
        setActiveSection(bestSection);
      },
      { rootMargin: "-80px 0px -40% 0px", threshold: 0 },
    );

    const sections = document.querySelectorAll("[data-section]");
    sections.forEach(s => observer.observe(s));

    return () => observer.disconnect();
  }, [loading, data]);

  const handleNavigate = useCallback((id: string) => {
    const el = document.querySelector(`[data-section="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleThemeToggle = async () => {
    const next = await themeManagerToggle();
    setTheme(next);
  };

  const handleExport = () => {
    window.print();
  };

  const handleClose = () => {
    window.close();
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Assembling your reflection...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="loading-screen">
        <div style={{ color: "var(--danger)" }}><AlertTriangle size={24} /></div>
        <div style={{ color: "var(--text-dim)" }}>Failed to load session data.</div>
        <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "8px 20px", background: "var(--accent)", color: "#1A1D3A", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="dash-layout">
      <Sidebar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        theme={theme}
        onThemeToggle={handleThemeToggle}
        onExport={handleExport}
        onClose={handleClose}
      />

      <div className="dash-main">
        <header className="dash-header">
          <div className="dash-header-left">
            <div>
              <div className="page-title">Dashboard</div>
              <div className="page-title-sub">Session Reflection</div>
            </div>
          </div>
          <div className="dash-header-right">
            <button className="header-btn" onClick={handleThemeToggle} aria-label="Toggle theme" title="Toggle theme">
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button className="header-btn" onClick={handleExport} aria-label="Export PDF" title="Export as PDF">
              <FileDown size={16} />
            </button>
            <button className="header-btn" onClick={handleClose} aria-label="Close" title="Close">
              <X size={16} />
            </button>
          </div>
        </header>

        <main className="dash-content" ref={contentRef}>
          <SectionOverview artifact={data.artifact} session={data.session} />
          <SectionFocus session={data.session} artifact={data.artifact} />
          <SectionResources artifact={data.artifact} session={data.session} />
          <SectionLearned artifact={data.artifact} />
          <SectionExplanations />
          <SectionReview artifact={data.artifact} />
          <SectionVisuals visuals={data.visuals} />
          <SectionInsights artifact={data.artifact} />
          <SectionProgress artifact={data.artifact} session={data.session} profile={data.profile} />
        </main>

        <footer className="dash-footer">
          <span>MindEase &mdash; Adaptive Learning</span>
          {data.session && <span>Session: {data.session.sessionId.slice(0, 8)}...</span>}
        </footer>
      </div>
    </div>
  );
};

/* ─── Mount ────────────────────────────────────────────────────────────────── */

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Dashboard />);
}
