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
  ChartBarBig, CircleCheck, Circle,
} from "lucide-react";

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

function cleanNoteText(raw: string): string {
  return raw
    .replace(/\[CHUNK\s*\d*\]/gi, "")
    .replace(/^---+$/gm, "")
    .replace(/\[\/?[A-Z]+\]/g, "")
    .replace(/\[CONCEPT:[^\]]+\]/g, "")
    .replace(/\[SUMMARY:[^\]]+\]/g, "")
    .replace(/\u2605\s*/g, "")
    .replace(/&#9734;\s*/g, "")
    .replace(/\s{3,}/g, "  ")
    .trim();
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

function Header({ theme, onThemeToggle }: {
  theme: "dark" | "light";
  onThemeToggle: (next: "dark" | "light") => void;
}) {
  return (
    <div className="header">
      <div className="header-logo"><Brain size={20} strokeWidth={2.5} /></div>
      <div className="header-text">
        <div className="header-title">MindEase</div>
        <div className="header-sub">Adaptive Learning</div>
      </div>
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
        <button className="btn btn-ghost" onClick={onResetProfile}>Reset All</button>
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
        <QTablePanel />
      </div>
    </>
  );
}

/* ── Q-Table Visualizer ── */

const ACTIONS_LABELS = [
  "chunk+", "chunk-", "simpl+", "simpl-", "pace+", "pace-", "visuals", "summ+", "summ-",
];

function QTablePanel() {
  const [qTable, setQTable] = useState<QTable | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const poll = async () => {
      const result = await browser.storage.local.get(STORAGE_KEYS.QTABLE);
      setQTable((result[STORAGE_KEYS.QTABLE] as QTable) ?? null);
    };
    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (!qTable) return null;

  const entries = Object.entries(qTable);
  if (entries.length === 0) return null;

  const ranked = entries
    .map(([key, vals]) => ({ key, maxQ: Math.max(...vals), vals }))
    .sort((a, b) => b.maxQ - a.maxQ)
    .slice(0, 5);

  return (
    <div className="qtable-section">
      <div className="section-title">RL Agent State ({entries.length} states)</div>
      <div className="qtable-list">
        {ranked.map(e => (
          <div className="qtable-row" key={e.key}>
            <div className="qtable-state">{e.key}</div>
            <div className="qtable-vals">
              {e.vals.map((v, i) => (
                <span
                  key={i}
                  className="qtable-val"
                  data-positive={v > 0}
                  data-negative={v < 0}
                >
                  {ACTIONS_LABELS[i]}:{v.toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="qtable-max">
        max Q: {ranked[0]?.maxQ.toFixed(3) ?? "-"}
      </div>
    </div>
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

/* ── Standalone Notes ── */

function StandaloneNotes({ notes }: { notes: HighlightNote[] }) {
  if (!notes.length) return null;
  return (
    <>
      <div className="hr" />
      <div className="section-title">Personal Notes</div>
      <div className="tab-list">
        {notes.slice(-10).reverse().map((n, i) => {
          const cleaned = cleanNoteText(n.text);
          const displayText = cleaned.length > 200 ? cleaned.slice(0, 200) + "…" : cleaned;
          return (
            <div className="item-card" key={i} style={{ borderLeft: "3px solid var(--accent)" }}>
              <div className="ic-body" style={{ fontStyle: "italic", color: "var(--text-primary)" }}>
                &ldquo;{displayText}&rdquo;
              </div>
              <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 6 }}>
                <span style={{ color: "var(--accent)" }}>{(n.resourceTitle || n.sourceUrl).slice(0, 30)}</span>
                <span>{new Date(n.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          );
        })}
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
  const [now, setNow] = useState(Date.now());

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
      STORAGE_KEYS.EXCLUDED_TABS,
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

  const handleStart = useCallback(async () => {
    setLoading(true);
    await browser.storage.local.set({
      [STORAGE_KEYS.EXTENSION_ACTIVE]: true,
      [STORAGE_KEYS.WORKSPACE]: null,
      [STORAGE_KEYS.EXCLUDED_TABS]: {},
      [STORAGE_KEYS.NOTES]: null,
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
    browser.tabs.create({ url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html?edit=1"), active: true });
  }, []);

  const handleResetProfile = useCallback(async () => {
    await browser.runtime.sendMessage({ type: "RESET_PROFILE" }).catch(() => {});
    browser.tabs.create({ url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"), active: true });
  }, []);

  const handleStartOnboarding = useCallback(() => {
    browser.tabs.create({ url: browser.runtime.getURL("src/layer2/onboarding/onboarding.html"), active: true });
  }, []);

  const handleDashboard = useCallback(() => {
    browser.tabs.create({ url: browser.runtime.getURL("src/session/dashboard/dashboard.html"), active: true });
  }, []);

  return (
    <>
      <Header theme={theme} onThemeToggle={setTheme} />
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
            <ContentControls profile={profile} />
          </>
        ) : (
          <NoProfile onStart={handleStartOnboarding} />
        )}

        <Explanations explanations={explanations} />

        {notes.length > 0 && <StandaloneNotes notes={notes} />}
      </div>
      {loading && <div className="loading-overlay"><div className="loading-spinner" /></div>}
    </>
  );
}

/* ── Mount ── */

const rootEl = document.getElementById("app");
if (rootEl) createRoot(rootEl).render(<App />);
