import { useState, useEffect } from "react";
import browser from "webextension-polyfill";
import { STORAGE_KEYS, type FullCognitiveProfile, type SessionHistoryEntry } from "@/types";
import { Sparkles, Brain, Clock, Layers, Sliders, CheckCircle2, History } from "lucide-react";

interface DimensionConfig {
  key: keyof FullCognitiveProfile["baseline"];
  label: string;
  icon: typeof Brain;
  lobe: string;
  description: string;
  path: string; // SVG path inside 600x340 viewport
  center: [number, number];
}

const DIMENSIONS: DimensionConfig[] = [
  {
    key: "formatPreference",
    label: "Format Priority",
    icon: Sparkles,
    lobe: "Visual Cortex",
    description: "Determines whether visual aids or concise text are prioritized first.",
    path: "M 300 45 C 380 40 470 65 520 120 C 510 160 460 175 410 175 C 360 175 320 130 300 120 Z",
    center: [415, 115],
  },
  {
    key: "readingPace",
    label: "Reading Pace",
    icon: Clock,
    lobe: "Temporal Pacing",
    description: "Adjusts speech narration speed and font hierarchy comfort.",
    path: "M 410 175 C 460 175 520 180 540 240 C 530 295 440 310 380 305 C 340 300 320 250 330 210 Z",
    center: [425, 245],
  },
  {
    key: "infoDensity",
    label: "Information Density",
    icon: Layers,
    lobe: "Prefrontal Core",
    description: "Controls section breakdown size and summary conciseness.",
    path: "M 300 120 C 320 130 360 175 330 210 C 300 240 250 240 220 205 C 220 160 260 130 300 120 Z",
    center: [285, 175],
  },
  {
    key: "learningApproach",
    label: "Learning Approach",
    icon: Sliders,
    lobe: "Frontal Executive",
    description: "Determines whether examples lead theory or concepts lead examples.",
    path: "M 300 45 C 220 40 130 65 80 120 C 90 160 140 175 190 175 C 240 175 280 130 300 120 Z",
    center: [185, 115],
  },
  {
    key: "attentionSpan",
    label: "Focus Chunking",
    icon: Brain,
    lobe: "Parietal Processing",
    description: "Defines comfortable reading burst sizes before resting.",
    path: "M 190 175 C 140 175 80 180 60 240 C 70 295 160 310 220 305 C 260 300 280 250 270 210 Z",
    center: [175, 245],
  },
  {
    key: "needsConceptAnchor",
    label: "Concept Anchors",
    icon: CheckCircle2,
    lobe: "Cerebellar Mapping",
    description: "Supplies visual roadmap pins before navigating new material.",
    path: "M 220 305 C 270 310 330 310 380 305 C 360 335 240 335 220 305 Z",
    center: [300, 315],
  },
];

function humanVal(val: unknown): string {
  if (typeof val === "boolean") return val ? "Enabled" : "Disabled";
  if (typeof val === "string") return val.replace(/-/g, " ");
  return String(val ?? "Default");
}

export function ProfileEvolution({
  profile,
  onEditRequested,
}: {
  profile: FullCognitiveProfile | null;
  onEditRequested?: () => void;
}) {
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const [activeDim, setActiveDim] = useState<DimensionConfig>(DIMENSIONS[0]);

  useEffect(() => {
    const load = () => {
      void browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY).then((data) => {
        setHistory((data[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[]) ?? []);
      });
    };
    load();
    browser.storage.onChanged.addListener(load);
    return () => browser.storage.onChanged.removeListener(load);
  }, []);

  const snapshots = history.filter((e) => e.profileSnapshot).sort((a, b) => b.endTime - a.endTime);
  const baseline = profile?.baseline;

  return (
    <div className="section-card profile-evolution-container">
      {/* Header */}
      <div className="profile-evolution-header">
        <div>
          <span className="profile-badge">Active Learning Profile</span>
          <h2 className="profile-title">Cognitive Preference Architecture</h2>
          <p className="profile-subtitle">
            An interactive map of your active study settings. Click any region to inspect how your
            preferences shape text chunking, examples, pacing, and visual anchors.
          </p>
        </div>
        {onEditRequested && (
          <button type="button" className="btn-edit-profile" onClick={onEditRequested}>
            <Sliders size={15} />
            <span>Customize Settings</span>
          </button>
        )}
      </div>

      {!profile ? (
        <div className="profile-empty-state">
          <Brain size={32} />
          <p>Complete onboarding or start a study session to initialize your cognitive profile.</p>
        </div>
      ) : (
        <>
          {/* Main Visualizer + Inspector Layout */}
          <div className="profile-map-grid">
            {/* SVG Brain Map */}
            <div className="profile-svg-card">
              <svg viewBox="0 0 600 360" className="brain-svg-viewport">
                <defs>
                  <radialGradient id="brainBgGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="transparent" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="activeLobeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.85" />
                  </linearGradient>
                </defs>

                {/* Ambient glow */}
                <ellipse cx="300" cy="190" rx="270" ry="160" fill="url(#brainBgGlow)" />

                {/* Outer Silhouette */}
                <path
                  d="M 300 35 C 440 25 560 90 550 200 C 540 290 440 330 300 340 C 160 330 60 290 50 200 C 40 90 160 25 300 35 Z"
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="2"
                  strokeDasharray="4 6"
                  opacity="0.4"
                />

                {/* Brain Lobes */}
                {DIMENSIONS.map((dim) => {
                  const isSelected = activeDim.key === dim.key;
                  return (
                    <g
                      key={dim.key}
                      className={`brain-lobe-group ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setActiveDim(dim)}
                      style={{ cursor: "pointer" }}
                    >
                      <path
                        d={dim.path}
                        className="brain-lobe-path"
                        fill={isSelected ? "url(#activeLobeGrad)" : "rgba(255, 255, 255, 0.04)"}
                        stroke={isSelected ? "#a78bfa" : "var(--border)"}
                        strokeWidth={isSelected ? "2.5" : "1.2"}
                      />
                      <circle
                        cx={dim.center[0]}
                        cy={dim.center[1]}
                        r={isSelected ? "18" : "14"}
                        fill={isSelected ? "#ffffff" : "var(--bg-surface-alt)"}
                        stroke={isSelected ? "#8b5cf6" : "var(--border)"}
                        strokeWidth="1.5"
                      />
                      <text
                        x={dim.center[0]}
                        y={dim.center[1] + 4}
                        textAnchor="middle"
                        fill={isSelected ? "#1e1b4b" : "var(--text-primary)"}
                        fontSize="11"
                        fontWeight="700"
                        pointerEvents="none"
                      >
                        {dim.label.split(" ")[0][0]}
                        {dim.label.split(" ")[1] ? dim.label.split(" ")[1][0] : ""}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="svg-hint">Click any lobe to inspect its role</div>
            </div>

            {/* Selected Inspector Card */}
            <div className="profile-detail-card">
              <div className="detail-header">
                <div className="detail-icon-wrap">
                  <activeDim.icon size={20} />
                </div>
                <div>
                  <span className="detail-region-tag">{activeDim.lobe}</span>
                  <h3 className="detail-title">{activeDim.label}</h3>
                </div>
              </div>

              <div className="detail-val-box">
                <span className="val-box-label">Current Configuration</span>
                <span className="val-box-val">{baseline ? humanVal(baseline[activeDim.key]) : "Default"}</span>
              </div>

              <p className="detail-desc">{activeDim.description}</p>

              <div className="detail-all-chips">
                {DIMENSIONS.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    className={`dim-chip ${d.key === activeDim.key ? "active" : ""}`}
                    onClick={() => setActiveDim(d)}
                  >
                    <span>{d.label}</span>
                    <strong>{baseline ? humanVal(baseline[d.key]) : "-"}</strong>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Clean Session Snapshots Section */}
          <div className="snapshots-section">
            <div className="snapshots-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <History size={16} />
                <h4>Session Change History</h4>
              </div>
              <span className="snapshots-count">{snapshots.length} snapshots recorded</span>
            </div>

            {snapshots.length === 0 ? (
              <div className="snapshots-empty">
                <p>No historical preference changes recorded yet. Snapshots are logged after completed sessions.</p>
              </div>
            ) : (
              <div className="snapshots-list">
                {snapshots.slice(0, 5).map((entry, idx) => {
                  const currentSnap = entry.profileSnapshot!.baseline;
                  const prevSnap = snapshots[idx + 1]?.profileSnapshot?.baseline;
                  const changedKeys = prevSnap
                    ? DIMENSIONS.filter((d) => prevSnap[d.key] !== currentSnap[d.key])
                    : [];

                  return (
                    <div key={entry.sessionId} className="snapshot-row">
                      <div className="snapshot-main">
                        <strong className="snapshot-name">{entry.customName || entry.name}</strong>
                        <span className="snapshot-date">
                          {new Date(entry.endTime).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="snapshot-changes">
                        {!prevSnap ? (
                          <span className="change-tag neutral">Baseline established</span>
                        ) : changedKeys.length === 0 ? (
                          <span className="change-tag neutral">Preferences maintained</span>
                        ) : (
                          changedKeys.map((k) => (
                            <span key={k.key} className="change-tag highlight">
                              {k.label}: {humanVal(prevSnap[k.key])} &rarr; {humanVal(currentSnap[k.key])}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
