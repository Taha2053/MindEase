import { SessionFolderLibrary } from "./SessionFolderLibrary";
import { MediaLibrary } from "./MediaLibrary";
import { HelpPage } from "./HelpPage";
import { ProfileEvolution } from "./ProfileEvolution";
import katexStyles from "katex/dist/katex.min.css?url";
import { useEffect, useState, useRef, useCallback, type FC } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/theme.css";
import "./dashboard.css";
import "@/styles/glass.css";
import browser from "webextension-polyfill";
import {
  applyTheme, loadTheme, toggleTheme as themeManagerToggle,
  getAppliedTheme, type Theme,
} from "@/utils/themeManager";
import { STORAGE_KEYS } from "@/types";
import type {
  WorkspaceSession, FullCognitiveProfile, PersonalizedArtifact,
  ResourceEntry, KeyConceptEntry, StudyCard, Gap,
  Connection, TabResource, FocusSummary, StateTransition,
  SessionState, AdaptationExplanation,
  CrossSourceConnection, VisualEntry,
  BaselineProfile, CognitiveNeed, RLSessionAdaptationRecord,
} from "@/types";
import { initialTransformationParams, updateProfile } from "@/layer2/profileManager";
import { loadExplanations } from "@/layer2/explainer";
import { rankAdaptations } from "@/layer2/recommendations";
import { SessionFeedbackPanel } from "./SessionFeedback";
import { DataControls } from "./DataControls";
import { loadSessionHistory, updateSessionName, deleteSessionEntry } from "@/session/sessionHistory";
import type { SessionHistoryEntry } from "@/types";
import {
  Brain, BarChart3, Timer, FolderOpen, FileText, Target,
  TrendingUp, Package, BookOpen, MessageCircle, RefreshCw,
  Image, Lightbulb, FileDown, Sun, Moon, X,
  AlertTriangle, Link, AlignStartVertical, BookOpenText,
  MessageSquare, Film, Globe, GraduationCap,
  LayoutDashboard, Eye, ChartNoAxesColumn, Sparkles, Clock,
  Volume2, VolumeX, Play, Plus, Puzzle,
} from "lucide-react";
import { speak, stop } from "@/utils/ttsManager";
import {
  submitDocumentForAnimation,
  submitArxivPaperForAnimation,
  pollJobStatus,
  fetchDocumentVideos,
} from "@/layer1/premiumClient";
import type { PremiumJobStatus } from "@/types";

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
  feedbackSessionId?: string;
}

async function loadData(): Promise<DashboardData> {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.WORKSPACE,
    "latestArtifact",
    STORAGE_KEYS.PROFILE,
    STORAGE_KEYS.VISUALS_CACHE,
    STORAGE_KEYS.SESSION_HISTORY,
  ]);

  const session = result[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | null;
  const artifact = result["latestArtifact"] as PersonalizedArtifact | null;
  const profile = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | null;
  const visualsCache = result[STORAGE_KEYS.VISUALS_CACHE] as { entries: VisualEntry[]; updatedAt: number } | null;
  const history = (result[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];

  return {
    session,
    artifact,
    profile,
    visuals: visualsCache?.entries ?? [],
    feedbackSessionId: session
      ? (session.state === "ended" ? session.sessionId : undefined)
      : artifact?.sessionId ?? history[0]?.sessionId,
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

function getNavItems(visualFirst: boolean): { id: string; label: string; icon: FC<{ size?: number }> }[] {
  const items = [
    { id: "overview", label: "Today", icon: LayoutDashboard },
    { id: "history", label: "Learning history", icon: Clock },
    { id: "review", label: "Review library", icon: BookOpen },
    { id: "profile", label: "My learning puzzle", icon: Puzzle },
    { id: "video-studio", label: "Video studio", icon: Film },
    { id: "data", label: "Account & data", icon: Package },
    { id: "help", label: "Help", icon: BookOpen },
  ];
  return items;
}

interface SidebarProps {
  activeSection: string;
  onNavigate: (id: string) => void;
  theme: Theme;
  onThemeToggle: () => void;
  onExport: () => void;
  onClose: () => void;
  navItems: { id: string; label: string; icon: FC<{ size?: number }> }[];
}

const Sidebar: FC<SidebarProps> = ({ activeSection, onNavigate, theme, onThemeToggle, onExport, onClose, navItems }) => (
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
      {navItems.map(item => (
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


/* ─── TTS Audio Button Component ───────────────────────────────────────────── */

const TtsAudioButton: FC<{ text: string; label?: string; className?: string }> = ({ text, label, className = "" }) => {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      if (playing) {
        stop();
      }
    };
  }, [playing]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (playing) {
      stop();
      setPlaying(false);
    } else {
      stop();
      setPlaying(true);
      speak(text, {
        onEnd: () => setPlaying(false),
        onError: () => setPlaying(false),
      }).catch(() => setPlaying(false));
    }
  };

  return (
    <button
      className={`dash-tts-btn ${playing ? "playing" : ""} ${className}`}
      onClick={handleToggle}
      title={playing ? "Stop listening" : "Listen aloud"}
      aria-label={playing ? "Stop listening" : "Listen aloud"}
    >
      {playing ? <VolumeX size={13} /> : <Volume2 size={13} />}
      {label && <span>{playing ? "Stop" : label}</span>}
    </button>
  );
};
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
    <section className="section-card overview-panel" id="section-overview" data-section="overview">
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

const DashboardHero: FC<{
  artifact: PersonalizedArtifact | null;
  session: WorkspaceSession | null;
  onAnimate: () => void;
}> = ({ artifact, session, onAnimate }) => {
  const focusScore = Math.round((artifact?.focusSummary?.focusScore ?? 0) * 100);
  const primaryConcept = artifact?.keyConcepts?.[0]?.label;
  const resourceCount = artifact?.resourcesUsed?.length ?? session?.tabs?.length ?? 0;
  const sessionDate = new Date(session?.startTime ?? Date.now()).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <section className="dashboard-hero" aria-labelledby="dashboard-hero-title">
      <div className="dashboard-hero-copy">
        <div className="dashboard-hero-date">{sessionDate}</div>
        <h1 id="dashboard-hero-title">
          {primaryConcept ? `Your work on ${primaryConcept}` : "Your learning session"}
        </h1>
        <p>
          {resourceCount > 0
            ? `${resourceCount} learning ${resourceCount === 1 ? "resource" : "resources"} brought together into one clear review.`
            : "Your focus, notes, and learning signals are organized here for review."}
        </p>
        <div className="dashboard-hero-actions">
          <button className="hero-primary-action" onClick={onAnimate}>
            <Film size={16} /> Animate a concept
          </button>
          <button className="hero-secondary-action" onClick={() => document.querySelector('[data-section="review"]')?.scrollIntoView({ behavior: "smooth" })}>
            <BookOpenText size={16} /> Review session
          </button>
        </div>
      </div>
      <div className="dashboard-hero-score" aria-label={`Focus score ${focusScore} percent`}>
        <span className="hero-score-value">{focusScore}%</span>
        <span className="hero-score-label">Focus score</span>
        <span className="hero-score-note">Based on this session</span>
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
        <h2>Resources by date</h2>
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
            <tr><th>Date</th><th>Resource</th><th>Type</th><th>Time</th><th>Notes</th><th>Concepts</th></tr>
          </thead>
          <tbody>
            {resources.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "var(--space-6)" }}>No resource data available.</td></tr>
            ) : (
              [...resources].sort((a, b) => b.joinedAt - a.joinedAt).map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.joinedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div className="li-concept" style={{ marginBottom: 0 }}>{c.concept}</div>
                <TtsAudioButton text={`${c.concept}. ${c.content}`} className="dash-tts-icon-only" />
              </div>
              <div className="li-content">{c.content}</div>
              <span className="li-format">{c.format}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const SectionExplanations: FC<{ profile: FullCognitiveProfile | null }> = ({ profile }) => {
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
  const recommendations = rankAdaptations(profile?.baseline);

  return (
    <section className="section-card" id="section-explanations" data-section="explanations">
      <div className="section-card-header">
        <MessageCircle size={16} />
        <h2>Why MindEase Adapted This Content</h2>
      </div>
      <div className="explanations-list">
        <div className="explain-item">
          <div className="explain-header">
            <span className="explain-icon explain-icon-vi"><Eye size={18} /></span>
            <span className="explain-title">Current recommendation order</span>
          </div>
          <div className="explain-body">
            First: {recommendations[0].label}. {recommendations[0].reason}
            {' '}This is a preference-based suggestion, not a diagnosis or proof that one format improves comprehension.
          </div>
        </div>
        {explanations.length === 0 ? (
          <div className="explain-empty">No experimental adaptation history is stored. Passive browsing signals do not change your settings.</div>
        ) : (
          <><p className="explain-empty">Experimental Q-learning history from earlier sessions; these records are not evidence of comprehension.</p>
          {explanations.map((e, i) => {
            const Icon = CATEGORY_ICONS[e.category] || MessageCircle;
            const iconClass = CATEGORY_ICON_CLASSES[e.category] || "";
            return (
              <div className="explain-item" key={i}>
                <div className="explain-header">
                  <span className={`explain-icon ${iconClass}`}><Icon size={18} /></span>
                  <span className="explain-title">{e.title}</span>
                  <span className="explain-action">{e.actionLabel}</span>
                  <TtsAudioButton text={`${e.title}. ${e.explanation}`} className="dash-tts-icon-only" />
                </div>
                <div className="explain-body">{e.explanation}</div>
                <div className="explain-meta">Adapted at {new Date(e.timestamp).toLocaleString()}</div>
              </div>
            );
          })}</>
        )}
      </div>
    </section>
  );
};

type ProfileChoice = {
  key: keyof BaselineProfile;
  label: string;
  options: readonly { value: BaselineProfile[keyof BaselineProfile]; label: string }[];
};

const PROFILE_CHOICES: readonly ProfileChoice[] = [
  { key: "formatPreference", label: "Format", options: [{ value: "text", label: "Structured text" }, { value: "visual", label: "Visual explanations" }] },
  { key: "attentionSpan", label: "Session length", options: [{ value: "short", label: "Short" }, { value: "medium", label: "Medium" }, { value: "long", label: "Long" }] },
  { key: "readingPace", label: "Reading pace", options: [{ value: "slow", label: "Slower" }, { value: "moderate", label: "Moderate" }, { value: "fast", label: "Faster" }] },
  { key: "infoDensity", label: "Detail", options: [{ value: "concise", label: "Concise" }, { value: "detailed", label: "Detailed" }] },
  { key: "learningApproach", label: "Explanation order", options: [{ value: "example-first", label: "Examples first" }, { value: "theory-first", label: "Theory first" }] },
] as const;

const valueLabel = (choice: ProfileChoice, profile: FullCognitiveProfile): string =>
  choice.options.find(option => option.value === profile.baseline[choice.key])?.label ?? String(profile.baseline[choice.key]);

const ProfileEditor: FC<{
  profile: FullCognitiveProfile | null;
  onChange: (profile: FullCognitiveProfile) => void;
}> = ({ profile, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  if (!profile) return null;

  const save = async (baseline: BaselineProfile, condition: CognitiveNeed = profile.condition) => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    const normalizedCondition = baseline.secondLanguageLearner && condition === "none" ? "multilingual" : condition;
    const next: FullCognitiveProfile = {
      ...profile,
      learningStyle: baseline.formatPreference,
      attentionSpan: baseline.attentionSpan,
      anchorNeed: baseline.needsConceptAnchor,
      condition: normalizedCondition,
      baseline,
      transformationParams: initialTransformationParams(baseline, normalizedCondition),
      updatedAt: Date.now(),
    };
    try {
      await updateProfile(next);
      await browser.runtime.sendMessage({ type: "PROFILE_UPDATED", payload: next }).catch(() => {});
      onChange(next);
      setStatus("Learning profile updated.");
    } catch {
      setStatus("Your profile could not be updated. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const setChoice = (key: keyof BaselineProfile, value: BaselineProfile[keyof BaselineProfile]) => {
    void save({ ...profile.baseline, [key]: value } as BaselineProfile);
  };

  const optionalPieces = [
    profile.baseline.needsConceptAnchor && { id: "anchors", label: "Concept anchors", remove: () => void save({ ...profile.baseline, needsConceptAnchor: false }) },
    profile.baseline.secondLanguageLearner && { id: "language", label: "English language support", remove: () => void save({ ...profile.baseline, secondLanguageLearner: false }, profile.condition === "multilingual" ? "none" : profile.condition) },
    profile.condition !== "none" && profile.condition !== "multilingual" && { id: "condition", label: `${profile.condition.toUpperCase()} support`, remove: () => void save(profile.baseline, "none") },
  ].filter(Boolean) as { id: string; label: string; remove: () => void }[];

  return <section className="section-card profile-editor" id="section-profile" data-section="profile">
    <div className="section-card-header profile-editor-heading">
      <Puzzle size={17} />
      <div><h2>Your learning profile</h2><p>These pieces guide recommendations. You control every piece.</p></div>
    </div>
    <div className="profile-pieces" aria-label="Current learning profile">
      {PROFILE_CHOICES.map(choice => <button className="profile-piece" type="button" key={choice.key} onClick={() => setEditing(true)} disabled={busy}>
        <span>{choice.label}</span><strong>{valueLabel(choice, profile)}</strong><span className="profile-piece-edit">Edit</span>
      </button>)}
      {optionalPieces.map(piece => <div className="profile-piece profile-piece-optional" key={piece.id}>
        <span>Support</span><strong>{piece.label}</strong>
        <button type="button" aria-label={`Remove ${piece.label}`} title={`Remove ${piece.label}`} onClick={piece.remove} disabled={busy}><X size={14} /></button>
      </div>)}
      <button className="profile-piece profile-piece-add" type="button" onClick={() => setEditing(value => !value)} disabled={busy} aria-expanded={editing}>
        <Plus size={16} /><strong>{editing ? "Close choices" : "Add or replace a piece"}</strong>
      </button>
    </div>
    {editing && <div className="profile-choice-panel">
      {PROFILE_CHOICES.map(choice => <fieldset key={choice.key}>
        <legend>{choice.label}</legend>
        <div>{choice.options.map(option => <button type="button" key={String(option.value)} className={profile.baseline[choice.key] === option.value ? "selected" : ""} onClick={() => setChoice(choice.key, option.value)} disabled={busy}>{option.label}</button>)}</div>
      </fieldset>)}
      <fieldset><legend>Optional support</legend><div>
        <button type="button" className={profile.baseline.needsConceptAnchor ? "selected" : ""} onClick={() => void save({ ...profile.baseline, needsConceptAnchor: true })} disabled={busy}>Concept anchors</button>
        <button type="button" className={profile.baseline.secondLanguageLearner ? "selected" : ""} onClick={() => void save({ ...profile.baseline, secondLanguageLearner: true }, profile.condition === "none" ? "multilingual" : profile.condition)} disabled={busy}>English language support</button>
        {(["adhd", "dyslexia", "autism"] as const).map(condition => <button type="button" key={condition} className={profile.condition === condition ? "selected" : ""} onClick={() => void save(profile.baseline, condition)} disabled={busy}>{condition.toUpperCase()} support</button>)}
      </div></fieldset>
    </div>}
    <p className="profile-status" role="status" aria-live="polite">{busy ? "Saving…" : status}</p>
  </section>;
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
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div className="review-concept">{g.conceptLabel}</div>
                  <TtsAudioButton text={`${g.conceptLabel}: ${g.text}`} className="dash-tts-icon-only" />
                </div>
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

const SectionVisuals: FC<{
  visuals: VisualEntry[];
  formatPreference: "visual" | "text";
  concepts: string[];
  onGenerateVisuals: () => void;
  generating: boolean;
}> = ({ visuals, formatPreference, concepts, onGenerateVisuals, generating }) => {
  const [zoomed, setZoomed] = useState<VisualEntry | null>(null);

  useEffect(() => {
    if (!zoomed) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zoomed]);

  return (
    <section className="section-card" id="section-visuals" data-section="visuals">
      <div className="section-card-header">
        <Image size={16} />
        <h2>Generated Visuals</h2>
      </div>
      {visuals.length > 0 ? (
        <div className="visuals-grid">
          {visuals.map((v, i) => (
            <div className="visual-card" key={i} style={{ cursor: "pointer" }} onClick={() => setZoomed(v)}>
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
      ) : formatPreference === "text" ? (
        <div className="visuals-placeholder" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "40px 20px" }}>
          <Image size={32} style={{ opacity: 0.3 }} />
          <p style={{ color: "var(--text-dim)", fontSize: "0.82rem", maxWidth: 320, textAlign: "center" }}>
            Visuals were not auto-generated for your text-oriented profile. Generate diagrams and infographics for the concepts you studied on demand.
          </p>
          <button
            onClick={onGenerateVisuals}
            disabled={generating || concepts.length === 0}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 24px",
              background: generating ? "var(--border)" : "var(--accent)",
              color: "#1A1D3A",
              border: "none", borderRadius: 10,
              cursor: generating || concepts.length === 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontWeight: 600, fontSize: "0.82rem",
              transition: "background 0.15s",
            }}
          >
            {generating ? (
              <><div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Generating...</>
            ) : (
              <><Sparkles size={16} /> Generate Visuals for {concepts.length} Concept{concepts.length !== 1 ? "s" : ""}</>
            )}
          </button>
          {concepts.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
              No concepts were captured in this session. Study some content first.
            </p>
          )}
        </div>
      ) : (
        <div className="visuals-placeholder">No visuals were generated during this session.</div>
      )}

      {zoomed && (
        <div
          onClick={() => setZoomed(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 40, cursor: "zoom-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "90vw", maxHeight: "90vh",
              background: "var(--bg-surface)",
              borderRadius: 18, overflow: "hidden",
              display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              cursor: "default",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px", borderBottom: "1px solid var(--border)",
              fontSize: "0.85rem", fontWeight: 600,
            }}>
              <span>{zoomed.concept}</span>
              <button
                onClick={() => setZoomed(null)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-dim)", padding: 4,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <img
              src={zoomed.dataUrl}
              alt={zoomed.concept}
              style={{
                display: "block",
                maxWidth: "100%", maxHeight: "calc(90vh - 60px)",
                objectFit: "contain", background: "var(--bg-base)",
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
};

/* ─── Video Studio (Premium) ───────────────────────────────────────────────── */

const SectionHistory: FC = () => {
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    loadSessionHistory().then(setHistory).catch(() => {});
  }, []);

  const handleRename = async (sessionId: string) => {
    const trimmed = editValue.trim();
    if (trimmed) {
      await updateSessionName(sessionId, trimmed);
      setHistory(prev => prev.map(e =>
        e.sessionId === sessionId ? { ...e, customName: trimmed } : e,
      ));
    }
    setEditingId(null);
    setEditValue("");
  };

  const handleDelete = async (sessionId: string) => {
    await deleteSessionEntry(sessionId);
    setHistory(prev => prev.filter(e => e.sessionId !== sessionId));
  };

  const displayName = (entry: SessionHistoryEntry): string => {
    return entry.customName ?? entry.name;
  };

  if (history.length === 0) {
    return (
      <section className="section-card" id="section-history" data-section="history">
        <div className="section-card-header">
          <Clock size={16} />
          <h2>Session History</h2>
        </div>
        <div className="empty-state">No past sessions yet. Complete a study session to build your history.</div>
      </section>
    );
  }

  return (
    <section className="section-card" id="section-history" data-section="history">
      <div className="section-card-header">
        <Clock size={16} />
        <h2>Session History</h2>
      </div>
      <div className="history-list">
        {[...history].sort((a, b) => b.endTime - a.endTime).map(entry => (
          <div className="history-item" key={entry.sessionId}>
            <time dateTime={new Date(entry.endTime).toISOString()}>{new Date(entry.endTime).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}</time>
            <div className="history-item-top">
              {editingId === entry.sessionId ? (
                <input
                  className="history-name-input"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => handleRename(entry.sessionId)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleRename(entry.sessionId);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className="history-name"
                  onClick={() => {
                    setEditingId(entry.sessionId);
                    setEditValue(displayName(entry));
                  }}
                  title="Click to rename"
                >
                  {displayName(entry)}
                </span>
              )}
              <span className="history-date">{new Date(entry.endTime).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
            <div className="history-metrics">
              <span className="history-metric">
                <Timer size={12} />
                {fmtDurationShort(entry.durationMs)}
              </span>
              <span className="history-metric">
                <Brain size={12} />
                {entry.conceptCount} concept{entry.conceptCount !== 1 ? "s" : ""}
              </span>
              <span className="history-metric">
                <FolderOpen size={12} />
                {entry.resourceCount} resource{entry.resourceCount !== 1 ? "s" : ""}
              </span>
              <span className="history-metric">
                <BarChart3 size={12} />
                Focus: {Math.round(entry.focusScore * 100)}%
              </span>
            </div>
            <div className="history-actions">
              <button
                className="history-action-btn"
                onClick={() => handleDelete(entry.sessionId)}
                aria-label="Delete session"
                title="Delete session"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

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
  const [activeSection, setActiveSection] = useState(location.hash.slice(1) || "overview");
  const [generating, setGenerating] = useState(false);
  const [visuals, setVisuals] = useState<VisualEntry[]>([]);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [rlNotice, setRlNotice] = useState<RLSessionAdaptationRecord | null>(null);
  const sectionRefs = useRef<Map<string, IntersectionObserverEntry>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadTheme().then(saved => { applyTheme(saved); setTheme(saved); });
    loadData().then(d => {
      setData(d);
      setVisuals(d.visuals);
      setLoading(false);
    }).catch(() => {
      setError(true);
      setLoading(false);
    });

    if (!document.getElementById("mindease-katex-css")) {
      const link = document.createElement("link");
      link.id = "mindease-katex-css";
      link.rel = "stylesheet";
      link.href = browser.runtime.getURL(katexStyles.replace(/^\//, ""));
      document.head.appendChild(link);
    }
  }, []);
  useEffect(() => {
    const currentId = data?.session?.sessionId ?? data?.artifact?.sessionId;
    if (!currentId) return;
    const consider = async (raw: unknown) => {
      const record = Array.isArray(raw) ? raw[0] as RLSessionAdaptationRecord | undefined : undefined;
      if (!record || record.sessionId !== currentId || !record.paramChanges?.length) return;
      const seen = await browser.storage.local.get("mindease_rl_notice_seen");
      if (seen.mindease_rl_notice_seen !== record.timestamp) setRlNotice(record);
    };
    void browser.storage.local.get(STORAGE_KEYS.RL_ADAPTATION_LOG)
      .then(saved => consider(saved[STORAGE_KEYS.RL_ADAPTATION_LOG]));
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && changes[STORAGE_KEYS.RL_ADAPTATION_LOG]) {
        void consider(changes[STORAGE_KEYS.RL_ADAPTATION_LOG].newValue);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [data?.session?.sessionId, data?.artifact?.sessionId]);

  useEffect(() => {
    const navigate = () => setActiveSection(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const handleNavigate = useCallback((id: string) => {
    if (id === "video-studio") {
      void browser.tabs.create({ url: browser.runtime.getURL("src/video/video.html") });
      return;
    }
    location.hash = id; setActiveSection(id); window.scrollTo(0, 0);
  }, []);

  const handleThemeToggle = async () => {
    const next = await themeManagerToggle();
    setTheme(next);
  };

  const handleExport = () => {
    void browser.tabs.create({ url: browser.runtime.getURL("src/session/dashboard/printReview.html") });
  };

  const handleClose = () => {
    window.close();
  };

  const handleGenerateVisuals = useCallback(async () => {
    if (!data?.artifact?.keyConcepts?.length) return;
    setGenerating(true);
    const concepts = data.artifact.keyConcepts.map(c => c.label);
    try {
      const response = await browser.runtime.sendMessage({
        type: "GENERATE_VISUALS",
        payload: { concepts },
      }) as { type: string; visuals: VisualEntry[] };
      setVisuals(response.visuals ?? []);
    } catch (err) {
      console.warn("[Dashboard] Generate visuals error:", err);
    } finally {
      setGenerating(false);
    }
  }, [data]);

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

  const visualFirst = data.profile?.baseline?.formatPreference === "visual";
  const navItems = getNavItems(visualFirst);
  const conceptLabels = data.artifact?.keyConcepts?.map(c => c.label) ?? [];

  return (
    <div className="dash-layout">
      <Sidebar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        theme={theme}
        onThemeToggle={handleThemeToggle}
        onExport={handleExport}
        onClose={handleClose}
        navItems={navItems}
      />

      <div className="dash-main">
        <header className="dash-header">
          <div className="dash-header-left">
            <div>
              <div className="page-title">Learning workspace</div>
              <div className="page-title-sub">Review, understand, continue</div>
            </div>
          </div>
          <div className="dash-header-right">
            <button className="header-btn" onClick={handleExport} aria-label="Export PDF" title="Export as PDF">
              <FileDown size={16} />
            </button>
            <button className="header-btn" onClick={handleClose} aria-label="Close" title="Close">
              <X size={16} />
            </button>
          </div>
        </header>

        <main className="dash-content" ref={contentRef}>
          {rlNotice && <aside className="section-card" role="status" aria-label="Next session adaptation">
            <div className="section-card-header"><Sparkles size={16} /><h2>What MindEase will adjust next session</h2></div>
            <p>Observed {rlNotice.telemetry.highlights} highlights, {rlNotice.telemetry.pauses} pauses and {rlNotice.telemetry.skips} skips. These signals suggest a presentation adjustment, not a diagnosis.</p>
            <ul>{rlNotice.paramChanges.map(change =>
              <li key={change.param}>{change.param.replace(/([A-Z])/g, " $1").toLowerCase()}: {String(change.from)} → {String(change.to)}</li>
            )}</ul>
            <button type="button" onClick={() => {
              void browser.storage.local.set({ mindease_rl_notice_seen: rlNotice.timestamp });
              setRlNotice(null);
            }}>Got it</button>
          </aside>}
          {activeSection === "overview" && <DashboardHero
            artifact={data.artifact}
            session={data.session}
            onAnimate={() => void browser.tabs.create({ url: browser.runtime.getURL("src/video/video.html") })}
          />}
          {activeSection === "overview" && <>
            <SectionOverview artifact={data.artifact} session={data.session} />
            <section className="section-card" aria-labelledby="session-summary-title">
              <div className="section-card-header"><BookOpenText size={16} /><h2 id="session-summary-title">Session summary</h2></div>
              <p>Reviewed {data.artifact?.resourcesUsed?.length ?? 0} sources and captured {data.artifact?.userNotes?.length ?? 0} notes.</p>
              {(data.artifact?.keyConcepts?.length ?? 0) > 0 && <p>Topics found in the source material: {data.artifact!.keyConcepts.map(c => c.label).join(", ")}.</p>}
              {(data.artifact?.studyCards ?? []).map(card =>
                <article key={card.id}><h3>{card.concept}</h3><p>{card.content}</p></article>
              )}
              {(data.artifact?.needsReview?.length ?? 0) > 0 && <p>{data.artifact!.needsReview.length} areas need another look; see Review for details.</p>}
              <button type="button" className="header-btn" onClick={handleExport}>Open complete review / Save as PDF</button>
            </section>
            <SectionFocus session={data.session} artifact={data.artifact} />
            <SessionFeedbackPanel key={data.feedbackSessionId} sessionId={data.feedbackSessionId} />
          </>}
          {activeSection === "history" && <>
            <SectionHistory />
            <SectionResources artifact={data.artifact} session={data.session} />
          </>}
          {activeSection === "review" && <>
            <SessionFolderLibrary />
            <MediaLibrary />
            <SectionLearned artifact={data.artifact} />
            <SectionReview artifact={data.artifact} />
            <SectionVisuals visuals={visuals} formatPreference={visualFirst ? "visual" : "text"} concepts={conceptLabels} onGenerateVisuals={handleGenerateVisuals} generating={generating} />
            <SectionInsights artifact={data.artifact} />
          </>}
          {activeSection === "profile" && <>
            <ProfileEvolution profile={data.profile} onEditRequested={() => {
              document.getElementById("section-profile")?.scrollIntoView({ behavior: "smooth" });
            }} />
            <ProfileEditor profile={data.profile} onChange={profile => setData(current => current ? { ...current, profile } : current)} />
            <SectionExplanations profile={data.profile} />
          </>}
          {activeSection === "data" && <DataControls />}
          {activeSection === "help" && <HelpPage />}
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
