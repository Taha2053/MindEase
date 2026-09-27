import type { RLSessionAdaptationRecord } from "@/types";
import { AccountControls } from "@/session/dashboard/AccountControls";
import { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import type {
  FullCognitiveProfile, SessionStats,
  ExtensionMessage, HighlightNote, AdaptationExplanation,
  UserOverrides, TransformationParams, WorkspaceSession,
  QTable,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import {
  initTheme, toggleTheme,
} from "@/utils/themeManager";
import { loadExplanations } from "@/layer2/explainer";
import {
  loadOverrides, saveOverrides, clearOverrides,
  paramLabel, paramOptions,
} from "@/layer2/userControls";
import {
  Brain, Moon, Sun, Settings, ChevronDown,
  ChartBarBig, CircleCheck, Circle, Volume2, VolumeX,
  AlertCircle,
} from "lucide-react";
import { ApiKeyModal } from "./ApiKeyModal";
import { hasRequiredKeys } from "@/utils/apiKeyManager";
import type { TtsSettings } from "@/types";
import {
  speak, stop, loadTtsSettings, saveTtsSettings,
  DEFAULT_TTS_SETTINGS,
} from "@/utils/ttsManager";

/* ── Helpers ── */

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "0m";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

const DISTRACTION_DOMAINS = [
  "facebook.com", "twitter.com", "x.com", "instagram.com",
  "tiktok.com", "reddit.com", "youtube.com", "netflix.com",
  "twitch.tv", "whatsapp.com", "discord.com",
];

/* ── Theme Toggle ── */

function ThemeToggle({ theme, onToggle }: {
  theme: "dark" | "light";
  onToggle: (next: "dark" | "light") => void;
}) {
  return (
    <button
      className="theme-toggle-popup"
      id="theme-toggle"
      aria-label="Toggle theme"
      onClick={async () => {
        const next = await toggleTheme();
        onToggle(next);
      }}
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

/* ── Header ── */

function Header({
  theme, onThemeToggle, onOpenSettings,
}: {
  theme: "dark" | "light";
  onThemeToggle: (next: "dark" | "light") => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="header">
      <div className="header-logo"><Brain size={20} strokeWidth={2.5} /></div>
      <div className="header-text">
        <div className="header-title">MindEase</div>
        <div className="header-sub">Adaptive Learning</div>
      </div>
      <button
        type="button"
        className="settings-btn-popup"
        onClick={onOpenSettings}
        title="API Keys & Services Settings"
        aria-label="API Keys & Services Settings"
      >
        <Settings size={16} />
      </button>
      <ThemeToggle theme={theme} onToggle={onThemeToggle} />
    </div>
  );
}

/* ── Session Bar ── */

function SessionBar({
  session, extActive, now, onStart, onStop, onResume,
}: {
  session: WorkspaceSession | null;
  extActive: boolean;
  now: number;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
}) {
  const isSessionActive = extActive && session?.state === "active";
  const isSessionPaused = extActive && session?.state === "passive";
  const hasSession = extActive && !!session;

  let indicator: string;
  let statusText: string;
  let timerText: string;

  if (isSessionActive) {
    indicator = "active";
    statusText = "Studying";
    timerText = `${fmtDuration(now - session!.startTime)} elapsed`;
  } else if (isSessionPaused) {
    indicator = "paused";
    statusText = "Paused";
    timerText = "Took a break";
  } else {
    indicator = "idle";
    statusText = "No active session";
    timerText = "Extension is idle";
  }

  return (
    <div className="session-bar">
      <span className={`session-indicator ${indicator}`} />
      <div className="session-info">
        <div className="session-status">{statusText}</div>
        <div className="session-timer">{timerText}</div>
      </div>
      <div className="session-actions">
        {hasSession ? (
          isSessionPaused ? (
            <button className="session-btn resume" onClick={onResume}>▶ Resume</button>
          ) : (
            <button className="session-btn stop" onClick={onStop}>■ Stop</button>
          )
        ) : (
          <button className="session-btn start" onClick={onStart}>▶ Start Session</button>
        )}
      </div>
    </div>
  );
}

/* ── Tab List ── */

function TabList({
  session, excludedTabs, onToggle,
}: {
  session: WorkspaceSession;
  excludedTabs: Record<number, boolean>;
  onToggle: (tabId: number) => void;
}) {
  if (!session.tabs || session.tabs.length === 0) return null;

  return (
    <>
      <div className="section-title">Tabs in Session ({session.tabs.length})</div>
      <div className="tab-list">
        {session.tabs.map((tab) => {
          const hostname = new URL(tab.url).hostname.replace("www.", "");
          const isDistraction = DISTRACTION_DOMAINS.some((d) => hostname.includes(d));
          const excluded = excludedTabs[tab.tabId] === true;
          const badge = excluded ? "excluded" : isDistraction ? "distraction" : "included";
          const label = excluded ? "Excluded" : isDistraction ? "Distraction" : "Included";
          return (
            <div className="tab-row" key={tab.tabId}>
              <img
                className="tab-favicon"
                src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=16`}
                alt=""
                loading="lazy"
              />
              <span className="tab-title">{tab.title || hostname}</span>
              <span className={`tab-badge ${badge}`}>{label}</span>
              <button
                className={`tab-toggle ${excluded ? "" : "on"}`}
                onClick={() => onToggle(tab.tabId)}
                title={excluded ? "Click to include" : "Click to exclude"}
              >
                {excluded ? <Circle size={12} /> : <CircleCheck size={12} />}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Stats Row ── */

function StatsRow({ highlights, pauses, skips }: {
  highlights: number; pauses: number; skips: number;
}) {
  return (
    <div className="stats-row">
      <div className="stat-card">
        <span className="num">{highlights}</span>
        <span className="label">Highlights</span>
      </div>
      <div className="stat-card">
        <span className="num">{pauses}</span>
        <span className="label">Pauses</span>
      </div>
      <div className="stat-card">
        <span className="num">{skips}</span>
        <span className="label">Skips</span>
      </div>
    </div>
  );
}

/* ── Profile Panel ── */

function ProfilePanel({
  profile, stats, onEditProfile, onResetProfile, onDashboard,
}: {
  profile: FullCognitiveProfile;
  stats: SessionStats;
  onEditProfile: () => void;
  onResetProfile: () => void;
  onDashboard: () => void;
}) {
  const p = profile.transformationParams;
  return (
    <>
      <StatsRow highlights={stats.totalHighlights} pauses={stats.totalPauses} skips={stats.totalSkips} />
      <div className="section-title">Cognitive Profile</div>
      <div className="profile-card">
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
            <span className="pi-label">Chunk Size</span>
            <span className="pi-value">{p.chunkSize}</span>
          </div>
          <div className="profile-item">
            <span className="pi-label">Simplify Level</span>
            <span className="pi-value">{p.simplificationLevel}</span>
          </div>
          <div className="profile-item">
            <span className="pi-label">Reading Pace</span>
            <span className="pi-value">{profile.baseline.readingPace}</span>
          </div>
          <div className="profile-item">
            <span className="pi-label">Sessions</span>
            <span className="pi-value">{profile.rlState.sessionCount}</span>
          </div>
        </div>
      </div>
      <div className="btn-group">
        <button className="btn btn-primary" onClick={onEditProfile}>Edit Profile</button>

      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={onDashboard}>
          <ChartBarBig size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Session Dashboard
        </button>
      </div>
    </>
  );
}

/* ── Content Controls ── */

function ContentControls({ profile }: { profile: FullCognitiveProfile }) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides_] = useState<UserOverrides | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      document.body.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }, 60);
    return () => clearTimeout(id);
  }, [open]);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    loadOverrides().then(setOverrides_);
  }, []);

  const setOverride = async (key: keyof TransformationParams, value: string | boolean | number) => {
    const ov = await loadOverrides();
    ov.enabled = true;
    (ov as unknown as Record<string, unknown>)[key] = value;
    await saveOverrides(ov);
    setOverrides_(ov);
    browser.runtime.sendMessage({ type: "CONTROLS_CHANGED" }).catch(() => {});
  };

  const resetOverrides = async () => {
    await clearOverrides();
    setOverrides_(null);
    browser.runtime.sendMessage({ type: "CONTROLS_CHANGED" }).catch(() => {});
  };

  if (!overrides) return null;

  const p = profile.transformationParams;
  const isActive = overrides.enabled && Object.keys(overrides).some((k) =>
    ["chunkSize", "simplificationLevel", "captionSpeed", "useVisualAnchors", "summaryFrequency"].includes(k)
    && (overrides as unknown as Record<string, unknown>)[k] !== undefined
  );
  const keys: (keyof TransformationParams)[] = [
    "chunkSize", "simplificationLevel", "captionSpeed",
    "useVisualAnchors", "summaryFrequency",
  ];
  const labelMap: Record<string, string> = {
    chunkSize: "Chunk Size", simplificationLevel: "Simplify", captionSpeed: "Pace",
    useVisualAnchors: "Visuals", summaryFrequency: "Summaries",
  };

  return (
    <>
      <button className="controls-toggle" onClick={toggle}>
        <span className="ct-label"><Settings size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Content Controls</span>
        <span className={`ct-badge ${isActive ? "ct-badge-on" : "ct-badge-off"}`}>
          {isActive ? "Custom" : "Auto"}
        </span>
        <span className={`ct-arrow ${open ? "open" : ""}`}>
          <ChevronDown size={14} />
        </span>
      </button>
      <div className={`controls-panel ${open ? "open" : ""}`}>
        {keys.map((key) => {
          const options = paramOptions(key);
          const overrideVal: string | boolean | number | undefined = overrides.enabled
            ? (overrides as unknown as Record<string, unknown>)[key] as string | boolean | number | undefined
            : undefined;
          const isOverridden = overrideVal !== undefined;
          const displayVal = isOverridden ? overrideVal : p[key];
          return (
            <div className="control-row" key={key}>
              <span className="control-label">{labelMap[key] || key}</span>
              <span className={`control-value ${isOverridden ? "overridden" : ""}`}>
                {paramLabel(key, displayVal)}
              </span>
              <div className="control-btns">
                {options.map((opt) => {
                  const active = String(opt) === String(displayVal);
                  const cls = active
                    ? (isOverridden ? "control-btn active-override" : "control-btn active")
                    : "control-btn";
                  return (
                    <button
                      key={String(opt)}
                      className={cls}
                      onClick={() => setOverride(key, opt)}
                    >
                      {paramLabel(key, opt)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="controls-footer">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={resetOverrides}>
            Reset to RL Defaults
          </button>
        </div>
      </div>
    </>
  );
}

/* ── TTS Settings Panel ── */

function TtsSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<TtsSettings>(DEFAULT_TTS_SETTINGS);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadTtsSettings().then(setSettings);
  }, []);

  const handleRateChange = async (rate: number) => {
    const updated = await saveTtsSettings({ rate });
    setSettings(updated);
  };


  const handleTestSpeech = async () => {
    if (testing) {
      stop();
      setTesting(false);
    } else {
      stop();
      setTesting(true);
      speak("MindEase text to speech is ready to read your study materials.", {
        rate: settings.rate,
        pitch: settings.pitch,
        voiceURI: settings.voiceURI,
        onEnd: () => setTesting(false),
        onError: () => setTesting(false),
      }).catch(() => setTesting(false));
    }
  };

  return (
    <>
      <button className="controls-toggle" onClick={() => setOpen(!open)} style={{ marginTop: 8 }}>
        <span className="ct-label">
          <Volume2 size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Voice &amp; Speech (TTS)
        </span>
        <span className="ct-badge ct-badge-on">
          {settings.rate}x
        </span>
        <span className={`ct-arrow ${open ? "open" : ""}`}>
          <ChevronDown size={14} />
        </span>
      </button>
      <div className={`controls-panel ${open ? "open" : ""}`}>
        <p style={{ color: "var(--text-muted)", fontSize: "0.72rem", lineHeight: 1.4 }}>English narration uses Azure Speech.</p>
        <div className="control-row">
          <span className="control-label">Speed</span>
          <span className="control-value">{settings.rate}x</span>
          <div className="control-btns">
            {[0.75, 1.0, 1.25, 1.5, 2.0].map((r) => (
              <button
                key={r}
                className={`control-btn ${settings.rate === r ? "active" : ""}`}
                onClick={() => handleRateChange(r)}
              >
                {r}x
              </button>
            ))}
          </div>
        </div>

        <div className="controls-footer" style={{ marginTop: 10 }}>
          <button
            className={`btn ${testing ? "btn-ghost" : "btn-primary"}`}
            style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onClick={handleTestSpeech}
          >
            {testing ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {testing ? "Stop Testing" : "Test Speech"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── RL Agent Panel (live) ── */

function RLAgentPanel({ profile }: { profile: FullCognitiveProfile }) {
  const [open, setOpen] = useState(false);
  const [recentRecord, setRecentRecord] = useState<RLSessionAdaptationRecord | null>(null);
  const baseline = profile.baseline;
  const rl = profile.rlState;

  useEffect(() => {
    void browser.storage.local.get(STORAGE_KEYS.RL_ADAPTATION_LOG).then((data) => {
      const logs = (data[STORAGE_KEYS.RL_ADAPTATION_LOG] ?? []) as RLSessionAdaptationRecord[];
      if (logs.length > 0) setRecentRecord(logs[0]);
    });
  }, [open]);

  return (
    <>
      <button className="rl-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        How adaptation works <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }} />
      </button>

      {open && (
        <div className="adaptation-clean-card">
          <p className="adaptation-card-desc">
            Your reading layout and chunking adapt at the end of each study session based on your real-time reading signals.
          </p>

          <div className="adaptation-grid-specs">
            <div className="spec-pill">
              <span>Format</span>
              <strong>{baseline.formatPreference}</strong>
            </div>
            <div className="spec-pill">
              <span>Chunking</span>
              <strong>{profile.transformationParams.chunkSize}</strong>
            </div>
            <div className="spec-pill">
              <span>Pace</span>
              <strong>{profile.transformationParams.captionSpeed}</strong>
            </div>
            <div className="spec-pill">
              <span>Density</span>
              <strong>{profile.transformationParams.summaryFrequency} sum.</strong>
            </div>
            <div className="spec-pill">
              <span>Approach</span>
              <strong>{baseline.learningApproach.replace("-", " ")}</strong>
            </div>
            <div className="spec-pill">
              <span>Anchors</span>
              <strong>{profile.transformationParams.useVisualAnchors ? "Active" : "Standard"}</strong>
            </div>
          </div>

          {/* Telemetry Data Section */}
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", color: "var(--text-muted)" }}>
              <span>Telemetry Gathered</span>
              <span>{rl.sessionCount} sessions logged</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, textAlign: "center" }}>
              <div style={{ background: "var(--bg-base)", padding: "4px 2px", borderRadius: 5, border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", display: "block" }}>Highlights</span>
                <strong style={{ fontSize: "0.76rem", color: "var(--accent)" }}>{rl.highlightRate}</strong>
              </div>
              <div style={{ background: "var(--bg-base)", padding: "4px 2px", borderRadius: 5, border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", display: "block" }}>Pauses</span>
                <strong style={{ fontSize: "0.76rem", color: "var(--accent)" }}>{rl.pauseRate}</strong>
              </div>
              <div style={{ background: "var(--bg-base)", padding: "4px 2px", borderRadius: 5, border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", display: "block" }}>Skips</span>
                <strong style={{ fontSize: "0.76rem", color: "var(--danger)" }}>{rl.skipRate}</strong>
              </div>
              <div style={{ background: "var(--bg-base)", padding: "4px 2px", borderRadius: 5, border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", display: "block" }}>Re-Reads</span>
                <strong style={{ fontSize: "0.76rem", color: "var(--text-primary)" }}>{rl.reReadRate}</strong>
              </div>
            </div>
          </div>

          {recentRecord && (
            <div style={{ background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", marginTop: 4 }}>
              <span style={{ fontSize: "0.66rem", color: "var(--accent)", fontWeight: 700, textTransform: "uppercase", display: "block" }}>
                Latest Session Tuning ({recentRecord.dominantSignal} bias)
              </span>
              <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "var(--text-dim)", lineHeight: 1.4 }}>
                {recentRecord.reason}
              </p>
            </div>
          )}

          <p className="adaptation-footer-note">
            Telemetry is analyzed during study, but updates apply only at session end for stability. Manual controls always take priority.
          </p>
        </div>
      )}
    </>
  );
}

/* ── No Profile ── */

function NoProfile({ onStart }: { onStart: () => void }) {
  return (
    <div className="waiting">
      <div className="w-icon"><Brain size={35} /></div>
      <div className="w-title">Welcome to MindEase</div>
      <p className="w-sub">Complete the onboarding to personalize your learning experience.</p>
      <button className="btn btn-primary" style={{ marginTop: 16, padding: "10px 24px" }} onClick={onStart}>
        Start Onboarding
      </button>
    </div>
  );
}

/* ── Explanations ── */

function Explanations({ explanations }: { explanations: AdaptationExplanation[] }) {
  if (explanations.length === 0) return null;
  return (
    <>
      <div className="hr" />
      <div className="section-title">Why MindEase Adapted This Content</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {explanations.slice(0, 3).map((e, i) => (
          <div key={i} style={{ background: "var(--bg-surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: "0.75rem" }}>
            <strong style={{ color: "var(--accent)" }}>{e.title}</strong>
            <p style={{ margin: "4px 0 0", color: "var(--text-dim)", lineHeight: 1.5 }}>{e.explanation}</p>
          </div>
        ))}
      </div>
    </>
  );
}



/* ── App ── */

function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [profile, setProfile] = useState<FullCognitiveProfile | undefined>();
  const [workspace, setWorkspace] = useState<WorkspaceSession | null>(null);
  const [extActive, setExtActive] = useState(false);
  const [stats, setStats] = useState<SessionStats>({
    engagedSections: [], skippedSections: [],
    totalHighlights: 0, totalPauses: 0, totalSkips: 0, dominantSignal: "pause",
  });
  const [notes, setNotes] = useState<HighlightNote[]>([]);
  const [excludedTabs, setExcludedTabs] = useState<Record<number, boolean>>({});
  const [explanations, setExplanations] = useState<AdaptationExplanation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [accountStep, setAccountStep] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hasKeys, setHasKeys] = useState(true);

  const checkKeys = useCallback(async () => {
    const ok = await hasRequiredKeys();
    setHasKeys(ok);
  }, []);

  useEffect(() => {
    checkKeys();
  }, [checkKeys]);

  // Live timer tick
  useEffect(() => {
    if (!extActive || !workspace || workspace.state !== "active") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [extActive, workspace]);

  const load = useCallback(async () => {
    const t = await initTheme();
    setTheme(t);

    const results = await browser.storage.local.get([
      STORAGE_KEYS.PROFILE, STORAGE_KEYS.SESSION_STATS, STORAGE_KEYS.NOTES,
      STORAGE_KEYS.EXTENSION_ACTIVE, STORAGE_KEYS.WORKSPACE,
      STORAGE_KEYS.EXCLUDED_TABS, "mindease_account_prompt",
    ]);

    setProfile(results[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined);
    setWorkspace((results[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | undefined) ?? null);
    setExtActive(results[STORAGE_KEYS.EXTENSION_ACTIVE] === true);
    setStats((results[STORAGE_KEYS.SESSION_STATS] as SessionStats | undefined) ?? {
      engagedSections: [], skippedSections: [],
      totalHighlights: 0, totalPauses: 0, totalSkips: 0, dominantSignal: "pause",
    });
    setExcludedTabs((results[STORAGE_KEYS.EXCLUDED_TABS] as Record<number, boolean>) || {});

    const notesCol = results[STORAGE_KEYS.NOTES] as { notes: HighlightNote[] } | undefined;
    if (notesCol?.notes) setNotes(notesCol.notes);

    const exps = await loadExplanations();
    const active = Object.values(exps).filter((e): e is AdaptationExplanation => e !== null);
    setExplanations(active);
    setAccountStep(results["mindease_account_prompt"] === true);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = (message: unknown) => {
      const msg = message as ExtensionMessage;
      if (msg.type === "HIGHLIGHTS_UPDATED") {
        browser.storage.local.get(STORAGE_KEYS.NOTES).then((updated) => {
          const data = updated[STORAGE_KEYS.NOTES] as { notes: HighlightNote[] } | undefined;
          if (data?.notes) setNotes(data.notes);
        });
      }
      if (msg.type === "ARTIFACT_READY") {
        load();
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => {
      browser.runtime.onMessage.removeListener(handler);
    };
  }, [load]);

  useEffect(() => {
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && (STORAGE_KEYS.PROFILE in changes || STORAGE_KEYS.WORKSPACE in changes)) void load();
    };
    browser.storage.onChanged.addListener(changed);
    return () => browser.storage.onChanged.removeListener(changed);
  }, [load]);

  const handleStart = useCallback(async () => {
    setLoading(true);
    await browser.storage.local.set({
      [STORAGE_KEYS.EXTENSION_ACTIVE]: true,
      [STORAGE_KEYS.WORKSPACE]: null,
      [STORAGE_KEYS.EXCLUDED_TABS]: {},
      [STORAGE_KEYS.NOTES]: null,
      [STORAGE_KEYS.SESSION_CHUNKS]: [],
    });
    await browser.runtime.sendMessage({ type: "SESSION_STATE_CHANGED", payload: { active: true } }).catch(() => {});
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) browser.tabs.sendMessage(tab.id, { type: "EXTENSION_STATE_CHANGED", active: true }).catch(() => {});
    }
    setExtActive(true);
    setWorkspace(null);
    setNow(Date.now());
    // re-fetch after background sets up workspace
    setTimeout(() => { load().then(() => setLoading(false)); }, 300);
  }, [load]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    await browser.storage.local.set({ [STORAGE_KEYS.EXTENSION_ACTIVE]: false });
    await browser.runtime.sendMessage({ type: "SESSION_END" }).catch(() => {});
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) browser.tabs.sendMessage(tab.id, { type: "EXTENSION_STATE_CHANGED", active: false }).catch(() => {});
    }
    setExtActive(false);
    setWorkspace(null);
    load().then(() => setLoading(false));
  }, [load]);

  const handleResume = useCallback(async () => {
    await browser.runtime.sendMessage({ type: "SESSION_STATE_CHANGED", payload: { active: true } }).catch(() => {});
    setNow(Date.now());
    setTimeout(() => load(), 200);
  }, [load]);

  const handleTabToggle = useCallback(async (tabId: number) => {
    const next = { ...excludedTabs };
    if (next[tabId]) {
      delete next[tabId];
    } else {
      next[tabId] = true;
    }
    setExcludedTabs(next);
    await browser.storage.local.set({ [STORAGE_KEYS.EXCLUDED_TABS]: next });
  }, [excludedTabs]);

  const handleEditProfile = useCallback(() => {
    browser.tabs.create({ url: browser.runtime.getURL("src/session/dashboard/dashboard.html#profile"), active: true });
  }, []);

  const handleResetProfile = handleEditProfile;
  const handleStartOnboarding = () => {
    void browser.tabs.create({ url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"), active: true });
  };

  const handleDashboard = useCallback(() => {
    browser.tabs.create({ url: browser.runtime.getURL("src/session/dashboard/dashboard.html"), active: true });
  }, []);

  if (!loaded) return <div className="body-wrap" role="status">Loading preferences…</div>;
  if (!profile) return <NoProfile onStart={handleStartOnboarding} />;
  if (accountStep) return (
    <div className="account-onboarding">
      <AccountControls compact />
      <button className="account-skip" onClick={async () => {
        await browser.storage.local.set({ mindease_account_prompt: false });
        setAccountStep(false);
      }}>
        Skip for now &mdash; continue locally
      </button>
    </div>
  );

  return (
    <>
      <Header
        theme={theme}
        onThemeToggle={setTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      {!hasKeys && (
        <div
          className="api-alert-banner"
          onClick={() => setIsSettingsOpen(true)}
          title="Click to configure your API key"
        >
          <AlertCircle size={14} />
          <span>API Key needed for AI restructuring</span>
          <span className="api-alert-action">Enter Key &rarr;</span>
        </div>
      )}
      <div className="body-wrap">
        <SessionBar
          session={workspace}
          extActive={extActive}
          now={now}
          onStart={handleStart}
          onStop={handleStop}
          onResume={handleResume}
        />

        {profile && extActive && workspace && (
          <TabList session={workspace} excludedTabs={excludedTabs} onToggle={handleTabToggle} />
        )}

        {profile ? (
          <>
            <ProfilePanel
              profile={profile}
              stats={stats}
              onEditProfile={handleEditProfile}
              onResetProfile={handleResetProfile}
              onDashboard={handleDashboard}
            />

            <TtsSettingsPanel />
            <RLAgentPanel profile={profile} />
            <button className="rl-toggle" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL("src/session/dashboard/dashboard.html#help"), active: true })}>Help &amp; how to use MindEase</button>
          </>
        ) : (
          <NoProfile onStart={handleStartOnboarding} />
        )}

        <Explanations explanations={explanations} />
      </div>
      <ApiKeyModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onKeysSaved={checkKeys}
      />
    </>
  );
}

/* ── Mount ── */

const rootEl = document.getElementById("app");
if (rootEl) createRoot(rootEl).render(<App />);
