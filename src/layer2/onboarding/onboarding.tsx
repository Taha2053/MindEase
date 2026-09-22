import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import browser from "webextension-polyfill";
import type {
  BaselineProfile, FullCognitiveProfile, CognitiveNeed,
  TransformationParams, ChunkSize, SimplificationLevel,
  CaptionSpeed, SummaryFrequency,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import { syncNow } from "@/utils/supabase";
import {
  applyTheme, loadTheme, toggleTheme as themeManagerToggle,
  type Theme,
} from "@/utils/themeManager";
import {
  BookOpenText, Brain, Check, Clock, Eye, Feather, Globe, Heart,
  HelpCircle, Home, Landmark, Library, Lightbulb, Map, Palette,
  PersonStanding, Play, Rainbow, RefreshCw, Rocket, Ruler, Search,
  Smile, Text, Timer, Waves, Zap,
} from "lucide-react";

/* ─── Types ─── */

interface Option {
  icon: string;
  label: string;
  description: string;
  value: string;
  skip?: boolean;
}

interface Question {
  id: keyof BaselineProfile | "condition";
  icon: string;
  title: string;
  subtitle: string;
  options: Option[];
}

/* ─── Data ─── */

const QUESTIONS: Question[] = [
  {
    id: "formatPreference",
    icon: "Eye",
    title: "Which format would you like to try first?",
    subtitle: "A starting preference, not a fixed learning style. You can choose a different format for each material.",
    options: [
      { icon: "Palette", label: "Show me - I need to see it", description: "Diagrams, images, mind maps make everything clearer.", value: "visual" },
      { icon: "BookOpenText", label: "Just tell me plainly", description: "Words work fine. Good writing is all I need.", value: "text" },
    ],
  },
  {
    id: "learningApproach",
    icon: "Lightbulb",
    title: "When exploring something new\u2026",
    subtitle: "How do you prefer to first meet an unfamiliar topic?",
    options: [
      { icon: "Play", label: "Show me examples first", description: "I get it faster when I see it in action.", value: "example-first" },
      { icon: "Landmark", label: "Explain the big idea first", description: "Give me the concept, then the examples make sense.", value: "theory-first" },
    ],
  },
  {
    id: "infoDensity",
    icon: "Ruler",
    title: "How much explanation should appear at once?",
    subtitle: "Your original material stays available in full. This changes the amount of extra explanation.",
    options: [
      { icon: "Zap", label: "Keep it sharp and quick", description: "Give me the essentials - I'll dig deeper if I need to.", value: "concise" },
      { icon: "Library", label: "Take me all the way down", description: "I want the full picture, nuance and all.", value: "detailed" },
    ],
  },
  {
    id: "attentionSpan",
    icon: "Timer",
    title: "How long would you like each reading section to be?",
    subtitle: "Choose a comfortable starting point. This does not measure your attention span.",
    options: [
      { icon: "Zap", label: "Short sections", description: "Frequent stopping points help me work through material.", value: "short" },
      { icon: "PersonStanding", label: "Medium sections", description: "Group a few related ideas together.", value: "medium" },
      { icon: "Heart", label: "Longer sections", description: "Keep more of the material visible together.", value: "long" },
    ],
  },
  {
    id: "condition",
    icon: "Brain",
    title: "Would you like to share a support need?",
    subtitle: "Optional and self-declared. MindEase does not diagnose conditions. Your selected preferences take priority.",
    options: [
      { icon: "Text", label: "Dyslexia", description: "Adjust text formatting and use visual anchors.", value: "dyslexia" },
      { icon: "Feather", label: "ADHD", description: "Shorter chunks, fewer distractions, frequent wins.", value: "adhd" },
      { icon: "Rainbow", label: "Autism / ASD", description: "Clear structure, literal language, predictable layout.", value: "autism" },
      { icon: "Check", label: "None of the above", description: "Standard tuning based on your preferences.", value: "none" },
      { icon: "Smile", label: "Prefer not to say", description: "Use my preferences without a condition label.", value: "undisclosed", skip: true },
    ],
  },
  {
    id: "secondLanguageLearner",
    icon: "Globe",
    title: "Would English terminology support be useful?",
    subtitle: "English is currently supported. Original wording stays intact; explanations can help with unfamiliar terms.",
    options: [
      { icon: "Globe", label: "Yes \u2014 this isn't my first language", description: "Simpler sentences and slower pacing help.", value: "true" },
      { icon: "Home", label: "No \u2014 this is my native language", description: "I'm comfortable reading and listening.", value: "false" },
    ],
  },
  {
    id: "readingPace",
    icon: "Clock",
    title: "What's your natural reading pace?",
    subtitle: "There's no right answer \u2014 just what feels right for you.",
    options: [
      { icon: "Clock", label: "Slow and careful", description: "I take my time, sometimes re-reading key parts.", value: "slow" },
      { icon: "PersonStanding", label: "Moderate and steady", description: "Comfortable cruising through most material.", value: "moderate" },
      { icon: "Rocket", label: "Fast and fluid", description: "I skim quickly and pick out the important bits.", value: "fast" },
    ],
  },
  {
    id: "needsConceptAnchor",
    icon: "Map",
    title: "Do you need the map before the journey?",
    subtitle: "Some want the big picture first. Others dive right in.",
    options: [
      { icon: "Map", label: "Yes \u2014 show me the big picture first", description: "I need to see where things fit before diving in.", value: "true" },
      { icon: "Search", label: "No \u2014 I'll explore as I go", description: "I prefer to build up to the big picture.", value: "false" },
    ],
  },
];

const TOTAL_STEPS = QUESTIONS.length;


/* ─── Icon map for rendering ─── */

const ICON_MAP: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string }>> = {
  BookOpenText, Brain, Check, Clock, Eye, Feather, Globe, Heart,
  HelpCircle, Home, Landmark, Library, Lightbulb, Map, Palette,
  PersonStanding, Play, Rainbow, RefreshCw, Rocket, Ruler, Search,
  Smile, Text, Timer, Waves, Zap,
};

function Icon({ name, size = 24 }: { name: string; size?: number }) {
  const Comp = ICON_MAP[name];
  if (!Comp) return null;
  return <Comp size={size} />;
}

/* ─── Feedback messages ─── */


/* ─── Helpers ─── */

function previewLabel(value: string): string {
  const map: Record<string, string> = {
    visual: "Visual", text: "Text",
    concise: "Concise", detailed: "Detailed",
    short: "Short bursts", medium: "Moderate", long: "Deep dives",
    slow: "Gentle", moderate: "Steady", fast: "Quick",
    small: "Small", large: "Large", normal: "Normal",
  };
  return map[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

function getTransformationParamsWithCondition(
  baseline: BaselineProfile,
  condition?: string,
): TransformationParams {
  let chunkSize: ChunkSize = "medium";
  let simplificationLevel: SimplificationLevel = 2;
  let captionSpeed: CaptionSpeed = "normal";
  let useVisualAnchors = baseline.formatPreference === "visual";
  let summaryFrequency: SummaryFrequency = "medium";

  if (baseline.attentionSpan === "short") {
    chunkSize = "small"; summaryFrequency = "high";
  } else if (baseline.attentionSpan === "long") {
    chunkSize = "large"; summaryFrequency = "low";
  }

  if (baseline.readingPace === "slow") {
    captionSpeed = "slow"; simplificationLevel = 3;
  } else if (baseline.readingPace === "fast") {
    captionSpeed = "fast"; simplificationLevel = 1;
  }

  if (baseline.secondLanguageLearner) {
    simplificationLevel = Math.min(3, simplificationLevel + 1) as SimplificationLevel;
    captionSpeed = "slow";
  }

  if (baseline.infoDensity === "concise") {
    chunkSize = chunkSize === "large" ? "medium" : "small";
    summaryFrequency = "high";
  }

  if (baseline.learningApproach === "example-first") {
    useVisualAnchors = true;
    simplificationLevel = Math.min(3, simplificationLevel + 1) as SimplificationLevel;
  }

  // Self-declared condition is context, never an override of chosen controls.

  return { chunkSize, simplificationLevel, captionSpeed, useVisualAnchors, summaryFrequency };
}

function generateProfileSummary(baseline: BaselineProfile, _condition?: string): string {
  return [
    baseline.formatPreference === "visual"
      ? "You chose visual explanations as a starting preference."
      : "You chose structured text as a starting preference.",
    "We will suggest options before adapting your material. Your source remains available.",
    "These choices do not measure learning ability or diagnose a condition.",
  ].join(" ");
}

/* ─── App component ─── */

export function Onboarding({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState(-1); // -1 = welcome, 0..7 = questions, 8 = done
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const isEditMode = false;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    void loadTheme().then(saved => { applyTheme(saved); setTheme(saved); });

  }, []);

  useEffect(() => {
    void browser.storage.local.get("mindease_onboarding_draft").then(result => {
      const draft = result.mindease_onboarding_draft as { step?: number; answers?: Record<string, string> } | undefined;
      if (draft?.answers) setAnswers(draft.answers);
      if (typeof draft?.step === "number") setStep(Math.max(-1, Math.min(TOTAL_STEPS - 1, draft.step)));
      setDraftLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (draftLoaded && step < TOTAL_STEPS) void browser.storage.local.set({ mindease_onboarding_draft: { step, answers } });
  }, [draftLoaded, step, answers]);

  const toggleThemeLocal = useCallback(async () => {
    const next = await themeManagerToggle();
    setTheme(next);
  }, []);

  const selectOption = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setFeedback("Preference selected. You can change it later.");
  }, []);

  const goNext = useCallback(async () => {
    if (step < 0) { setStep(0); return; }
    const q = QUESTIONS[step];
    if (!answers[q.id]) return;
    if (step === TOTAL_STEPS - 1) {
      if (saving) return;
      setSaving(true);
      setSaveError("");
      try {
        await saveProfile();
        setStep(TOTAL_STEPS);
        onComplete?.();
      } catch {
        setSaveError("Your preferences could not be saved. Try again.");
      } finally {
        setSaving(false);
      }
    } else {
      setStep((s) => s + 1);
    }
  }, [step, answers, saving]);

  const goBack = useCallback(() => {
    if (step >= 0) setStep((s) => s - 1);
  }, [step]);

  async function saveProfile() {
    const baseline: BaselineProfile = {
      formatPreference: (answers.formatPreference as BaselineProfile["formatPreference"]) ?? "text",
      attentionSpan: (answers.attentionSpan as BaselineProfile["attentionSpan"]) ?? "medium",
      readingPace: (answers.readingPace as BaselineProfile["readingPace"]) ?? "moderate",
      needsConceptAnchor: answers.needsConceptAnchor === "true",
      secondLanguageLearner: answers.secondLanguageLearner === "true",
      infoDensity: (answers.infoDensity as BaselineProfile["infoDensity"]) ?? "detailed",
      learningApproach: (answers.learningApproach as BaselineProfile["learningApproach"]) ?? "theory-first",
    };

    const rawCondition = answers.condition;
    const mappedCondition: CognitiveNeed =
      rawCondition === "dyslexia" || rawCondition === "adhd" || rawCondition === "autism"
        ? rawCondition
        : baseline.secondLanguageLearner
          ? "multilingual"
          : "none";

    const params = getTransformationParamsWithCondition(baseline, rawCondition);


    const profile = {
      userId: uuidv4(),
      learningStyle: baseline.formatPreference === "visual" ? "visual" : "text",
      attentionSpan: baseline.attentionSpan,
      anchorNeed: baseline.needsConceptAnchor,
      condition: mappedCondition,
      updatedAt: Date.now(),
      createdAt: new Date().toISOString(),
      baseline,
      rlState: { highlightRate: 0, pauseRate: 0, reReadRate: 0, skipRate: 0, sessionCount: 0, totalEngagementScore: 0 },
      transformationParams: params,
    };

    await browser.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile, [STORAGE_KEYS.ONBOARDING_DONE]: true, mindease_account_prompt: true });
    await browser.storage.local.remove("mindease_onboarding_draft");
    await syncNow().catch(() => {});
    try { await browser.runtime.sendMessage({ type: "ONBOARDING_COMPLETE" }); }
    catch { /* ok */ }
  }

  const progressPct = step < 0 ? 0 : step >= TOTAL_STEPS ? 100 : ((step + 1) / TOTAL_STEPS) * 100;
  const progressLabel = step < 0 ? "Welcome" : step >= TOTAL_STEPS ? "All done!" : `Question ${step + 1} of ${TOTAL_STEPS}`;
  const showNav = step >= 0 && step < TOTAL_STEPS;

  return (
    <>
      <div className="container" role="main">
      <header className="brand-header">
        <div className="brand-left">
          <div className="brand-icon"><Brain size={18} /></div>
          <div className="brand-text">
            <span className="brand-name">MindEase</span>
            <span className="brand-tagline">Adaptive Learning</span>
          </div>
        </div>
        <button
          id="theme-toggle"
          className="theme-toggle"
          aria-label="Toggle theme"
          onClick={toggleThemeLocal}
        >
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </button>
      </header>

      <div className="progress-section">
        <div className="progress-track" role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPct)}>
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="progress-label">{progressLabel}</span>
      </div>

      <div className="card-stage">
        <div className="card">
          {step < 0 && (
            <div className="welcome-screen screen-enter" key="welcome">
              <div className="welcome-icon"><Brain size={24} /></div>
              <h1 className="welcome-title">Welcome to MindEase</h1>
              <p className="welcome-sub">
                Set your starting preferences once. Choose how you want help with
                the material you are studying, and adjust through feedback later.
              </p>
              <button className="welcome-cta" onClick={() => setStep(0)}>
                Set my preferences
              </button>
            </div>
          )}

          {step >= 0 && step < TOTAL_STEPS && (() => {
            const q = QUESTIONS[step];
            const selectedValue = answers[q.id];
            return (
              <div className="question-screen screen-enter" key={step}>
                <h2 className="question-title"><Icon name={q.icon} /> {q.title}</h2>
                <p className="question-sub">{q.subtitle}</p>
                <div className="options-grid" role="radiogroup" aria-label={q.title}>
                  {q.options.map((opt) => (
                    <div
                      key={opt.value}
                      className={`option-card ${selectedValue === opt.value ? "selected" : ""} ${opt.skip ? "other-option" : ""}`}
                      data-value={opt.value}
                      role="radio"
                      tabIndex={selectedValue === opt.value || (!selectedValue && q.options[0].value === opt.value) ? 0 : -1}
                      aria-checked={selectedValue === opt.value}
                      onClick={() => selectOption(q.id, opt.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectOption(q.id, opt.value);
                        }
                        const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                        if (direction) {
                          event.preventDefault();
                          const current = q.options.findIndex(item => item.value === opt.value);
                          const next = q.options[(current + direction + q.options.length) % q.options.length];
                          selectOption(q.id, next.value);
                          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
                        }
                      }}
                    >
                      <div className="option-emoji"><Icon name={opt.icon} /></div>
                      <div className="option-text-wrapper">
                        <span className="option-label">{opt.label}</span>
                        <span className="option-desc">{opt.description}</span>
                      </div>
                      <div className="option-check">{selectedValue === opt.value ? "✓" : ""}</div>
                    </div>
                  ))}
                </div>
                {feedback && <div className="micro-feedback" role="status" aria-live="polite" key={feedback}>{feedback}</div>}
              </div>
            );
          })()}

          {step >= TOTAL_STEPS && (() => {
            const baseline: BaselineProfile = {
              formatPreference: (answers.formatPreference as BaselineProfile["formatPreference"]) ?? "text",
              attentionSpan: (answers.attentionSpan as BaselineProfile["attentionSpan"]) ?? "medium",
              readingPace: (answers.readingPace as BaselineProfile["readingPace"]) ?? "moderate",
              needsConceptAnchor: answers.needsConceptAnchor === "true",
              secondLanguageLearner: answers.secondLanguageLearner === "true",
              infoDensity: (answers.infoDensity as BaselineProfile["infoDensity"]) ?? "detailed",
              learningApproach: (answers.learningApproach as BaselineProfile["learningApproach"]) ?? "theory-first",
            };
            const params = getTransformationParamsWithCondition(baseline, answers.condition);
            const summary = generateProfileSummary(baseline, answers.condition);

            return (
              <div className="done-screen screen-enter" key="done">
                <div className="done-icon"><Brain size={22} /></div>
                <h2 className="done-title">You're all set!</h2>
                <p className="done-sub">Here's what we've put together for you.</p>
                <div className="done-profile-summary">{summary}</div>
                <div className="done-preview-grid">
                  {[
                    ["Format", previewLabel(baseline.formatPreference)],
                    ["Approach", baseline.learningApproach === "example-first" ? "Examples first" : "Theory first"],
                    ["Density", previewLabel(baseline.infoDensity)],
                    ["Focus", previewLabel(baseline.attentionSpan)],
                    ["Pace", previewLabel(baseline.readingPace)],
                    ["Chunks", previewLabel(params.chunkSize)],
                    ["Simplify", `Level ${params.simplificationLevel}`],
                    ["Captions", previewLabel(params.captionSpeed)],
                  ].map(([label, value]) => (
                    <div className="preview-item" key={label}>
                      <span className="preview-label">{label}</span>
                      <span className="preview-value">{value}</span>
                    </div>
                  ))}
                </div>
                <button className="btn-start" onClick={() => onComplete?.()}>
                  Start Learning →
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {showNav && (
        <div className="nav-row">
          {saveError && <p role="alert">{saveError}</p>}
          <button className="btn-back" onClick={goBack}>
            ← Back
          </button>
          <button
            className={`btn-next ${answers[QUESTIONS[step].id] ? "enabled" : ""}`}
            disabled={saving || !answers[QUESTIONS[step].id]}
            onClick={goNext}
          >
            {saving ? "Saving preferences…" : step === TOTAL_STEPS - 1 ? "Save my preferences" : "Continue"}
          </button>
        </div>
      )}
    </div>
    </>
  );
}

/* ─── Sun / Moon icon components ─── */

function Sun({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function Moon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

