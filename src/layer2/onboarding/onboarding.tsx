import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import browser from "webextension-polyfill";
import type {
  BaselineProfile, CognitiveNeed,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import { syncNow } from "@/utils/supabase";
import { initialTransformationParams } from "@/layer2/profileManager";
import {
  applyTheme, loadTheme, toggleTheme as themeManagerToggle,
  type Theme,
} from "@/utils/themeManager";
import {
  BookOpenText, Brain, Check, Clock, Eye, Feather, Globe, Heart,
  HelpCircle, Home, Landmark, Languages, Library, Lightbulb, Map, Palette,
  PersonStanding, Play, Rainbow, RefreshCw, Rocket, Ruler, Search,
  Smile, Text, Timer, Volume2, VolumeX, Waves, Zap,
} from "lucide-react";
import { mapSupportNeeds } from "./supportHintsMapper";

/* ─── Types ─── */

interface Option {
  icon: string;
  label: string;
  description: string;
  value: string;
  skip?: boolean;
}

interface Question {
  id: keyof BaselineProfile | "condition" | "preferredLanguage" | "autoReadAloud";
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
    id: "preferredLanguage",
    icon: "Languages",
    title: "What language do you prefer to learn in?",
    subtitle: "Choose the language you're most comfortable reading and studying in. Content explanations will target this language.",
    options: [
      { icon: "Globe", label: "English", description: "en", value: "en" },
      { icon: "Globe", label: "العربية (Arabic)", description: "ar", value: "ar" },
      { icon: "Globe", label: "中文 (Chinese)", description: "zh", value: "zh" },
      { icon: "Globe", label: "Español (Spanish)", description: "es", value: "es" },
      { icon: "Globe", label: "Français (French)", description: "fr", value: "fr" },
      { icon: "Globe", label: "हिन्दी (Hindi)", description: "hi", value: "hi" },
      { icon: "Globe", label: "日本語 (Japanese)", description: "ja", value: "ja" },
      { icon: "Globe", label: "Português (Portuguese)", description: "pt", value: "pt" },
      { icon: "Globe", label: "Русский (Russian)", description: "ru", value: "ru" },
      { icon: "Globe", label: "Türkçe (Turkish)", description: "tr", value: "tr" },
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
  {
    id: "autoReadAloud",
    icon: "Volume2",
    title: "Automatically read adapted sections aloud?",
    subtitle: "When you choose an adaptation, the adapted text can be read aloud automatically. Audio will not play without this choice.",
    options: [
      { icon: "Volume2", label: "Yes — read aloud automatically", description: "Play audio of adapted sections when they appear.", value: "true" },
      { icon: "VolumeX", label: "No — I'll read on my own", description: "No automatic audio. You can still use read-aloud manually.", value: "false" },
    ],
  },
];

const TOTAL_STEPS = QUESTIONS.length;


/* ─── Icon map for rendering ─── */

const ICON_MAP: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string }>> = {
  BookOpenText, Brain, Check, Clock, Eye, Feather, Globe, Heart,
  HelpCircle, Home, Landmark, Languages, Library, Lightbulb, Map, Palette,
  PersonStanding, Play, Rainbow, RefreshCw, Rocket, Ruler, Search,
  Smile, Text, Timer, Volume2, VolumeX, Waves, Zap,
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
  const [theme, setTheme] = useState<Theme>("light");
  const isEditMode = false;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [supportNeedsText, setSupportNeedsText] = useState("");
  const [customLanguage, setCustomLanguage] = useState("");
  const [customLanguageLabel, setCustomLanguageLabel] = useState("");

  useEffect(() => {
    void loadTheme().then(saved => { applyTheme(saved); setTheme(saved); });

  }, []);

  useEffect(() => {
    void browser.storage.local.get("mindease_onboarding_draft").then(result => {
      const draft = result.mindease_onboarding_draft as {
        step?: number; answers?: Record<string, string>;
        supportNeedsText?: string; customLanguage?: string; customLanguageLabel?: string;
      } | undefined;
      if (draft?.answers) setAnswers(draft.answers);
      if (draft?.supportNeedsText) setSupportNeedsText(draft.supportNeedsText);
      if (draft?.customLanguage) setCustomLanguage(draft.customLanguage);
      if (draft?.customLanguageLabel) setCustomLanguageLabel(draft.customLanguageLabel);
      if (typeof draft?.step === "number") setStep(Math.max(-1, Math.min(TOTAL_STEPS - 1, draft.step)));
      setDraftLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (draftLoaded && step < TOTAL_STEPS) void browser.storage.local.set({
      mindease_onboarding_draft: { step, answers, supportNeedsText, customLanguage, customLanguageLabel },
    });
  }, [draftLoaded, step, answers, supportNeedsText, customLanguage, customLanguageLabel]);

  const toggleThemeLocal = useCallback(async () => {
    const next = await themeManagerToggle();
    setTheme(next);
  }, []);

  const selectOption = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    if (questionId === "preferredLanguage") {
      setCustomLanguage("");
      setCustomLanguageLabel("");
    }
  }, []);

  const goNext = useCallback(async () => {
    if (step < 0) { setStep(0); return; }
    const q = QUESTIONS[step];
    if (!answers[q.id] && !(q.id === "condition" && supportNeedsText.trim())) return;
    if (q.id === "preferredLanguage") {
      try { Intl.getCanonicalLocales(answers.preferredLanguage); }
      catch { setSaveError("Enter a valid language tag such as en, ar, or zh-Hans."); return; }
    }
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
    // Resolve preferred language: custom typed value takes priority over option selection
    const resolvedLanguage = Intl.getCanonicalLocales(customLanguage.trim() || answers.preferredLanguage || "en")[0];

    const baseline: BaselineProfile = {
      formatPreference: (answers.formatPreference as BaselineProfile["formatPreference"]) ?? "text",
      attentionSpan: (answers.attentionSpan as BaselineProfile["attentionSpan"]) ?? "medium",
      readingPace: (answers.readingPace as BaselineProfile["readingPace"]) ?? "moderate",
      needsConceptAnchor: answers.needsConceptAnchor === "true",
      secondLanguageLearner: answers.secondLanguageLearner === "true",
      infoDensity: (answers.infoDensity as BaselineProfile["infoDensity"]) ?? "detailed",
      learningApproach: (answers.learningApproach as BaselineProfile["learningApproach"]) ?? "theory-first",
      preferredLanguage: resolvedLanguage,
      autoReadAloud: answers.autoReadAloud === "true",
    };

    // Always store raw support needs text, regardless of LLM success
    const rawNeeds = supportNeedsText.trim();
    if (rawNeeds) {
      baseline.supportNeeds = rawNeeds;
    }

    // Attempt AI-derived presentation hints (non-blocking; raw text preserved above)
    if (rawNeeds) {
      const hints = await mapSupportNeeds(rawNeeds).catch(() => undefined);
      if (hints) {
        baseline.supportHints = hints;
      }
    }

    const rawCondition = answers.condition;
    const mappedCondition: CognitiveNeed =
      rawCondition === "dyslexia" || rawCondition === "adhd" || rawCondition === "autism"
        ? rawCondition
        : baseline.secondLanguageLearner
          ? "multilingual"
          : "none";

    const params = initialTransformationParams(baseline, mappedCondition);

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
      <div className="onboarding-bg-wrap" aria-hidden="true">
        <img
          src={typeof browser !== "undefined" && browser.runtime?.getURL ? browser.runtime.getURL("onboarding-bg.png") : "/onboarding-bg.png"}
          alt=""
          className="onboarding-bg-image"
        />
        <div className="onboarding-bg-overlay" />
      </div>
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
                    </div>
                  ))}
                </div>

                {/* Condition step: free-form support needs */}
                {q.id === "condition" && (
                  <div className="support-needs-section">
                    <label className="support-needs-label" htmlFor="support-needs-input">
                      Or describe what helps you learn in your own words <span className="optional-badge">(optional)</span>
                    </label>
                    <textarea
                      id="support-needs-input"
                      className="support-needs-input"
                      placeholder="e.g. I find it hard to focus on long paragraphs, audio helps me follow along…"
                      value={supportNeedsText}
                      onChange={(e) => setSupportNeedsText(e.target.value)}
                      maxLength={500}
                      rows={3}
                    />
                    {supportNeedsText.trim() && (
                      <p className="ai-disclosure" role="note">
                        Your description will be sent to an AI service to suggest presentation adjustments.
                        Your original text is always saved, even if the AI is unavailable.
                      </p>
                    )}
                  </div>
                )}

                {/* Language step: custom BCP47 input */}
                {q.id === "preferredLanguage" && (
                  <div className="custom-language-section">
                    <label className="support-needs-label" htmlFor="custom-language-input">
                      Don't see your language? Type it here:
                    </label>
                    <div className="custom-language-row">
                      <input
                        id="custom-language-input"
                        className="custom-language-input"
                        type="text"
                        placeholder="e.g. ko, de, ur, sw…"
                        value={customLanguage}
                        onChange={(e) => {
                          const tag = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                          setCustomLanguage(tag);
                          if (tag) {
                            // Deselect any option card when using custom input
                            setAnswers((prev) => ({ ...prev, preferredLanguage: tag }));
                          }
                        }}
                        maxLength={11}
                        aria-describedby="custom-lang-hint"
                      />
                      <input
                        className="custom-language-input custom-language-name"
                        type="text"
                        placeholder="Language name (optional)"
                        value={customLanguageLabel}
                        onChange={(e) => setCustomLanguageLabel(e.target.value)}
                        maxLength={40}
                      />
                    </div>
                    <p className="custom-lang-hint" id="custom-lang-hint">
                      Enter a BCP 47 language tag. Examples: ko (Korean), de (German), sw (Swahili).
                    </p>
                  </div>
                )}

              </div>
            );
          })()}

          {step >= TOTAL_STEPS && (() => {
            const resolvedLang = customLanguage.trim() || answers.preferredLanguage || "en";
            const langLabel = customLanguageLabel.trim()
              || QUESTIONS.find(q => q.id === "preferredLanguage")?.options.find(o => o.value === resolvedLang)?.label
              || resolvedLang;
            const baseline: BaselineProfile = {
              formatPreference: (answers.formatPreference as BaselineProfile["formatPreference"]) ?? "text",
              attentionSpan: (answers.attentionSpan as BaselineProfile["attentionSpan"]) ?? "medium",
              readingPace: (answers.readingPace as BaselineProfile["readingPace"]) ?? "moderate",
              needsConceptAnchor: answers.needsConceptAnchor === "true",
              secondLanguageLearner: answers.secondLanguageLearner === "true",
              infoDensity: (answers.infoDensity as BaselineProfile["infoDensity"]) ?? "detailed",
              learningApproach: (answers.learningApproach as BaselineProfile["learningApproach"]) ?? "theory-first",
              preferredLanguage: resolvedLang,
              autoReadAloud: answers.autoReadAloud === "true",
            };
            const params = initialTransformationParams(baseline, answers.condition as CognitiveNeed);
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
                    ["Language", langLabel],
                    ["Chunks", previewLabel(params.chunkSize)],
                    ["Read aloud", baseline.autoReadAloud ? "Auto" : "Manual"],
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
            className={`btn-next ${answers[QUESTIONS[step].id] || (QUESTIONS[step].id === "condition" && supportNeedsText.trim()) ? "enabled" : ""}`}
            disabled={saving || (!answers[QUESTIONS[step].id] && !(QUESTIONS[step].id === "condition" && supportNeedsText.trim()))}
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

