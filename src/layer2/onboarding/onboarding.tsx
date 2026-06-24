import { useState, useEffect, useCallback } from "react";
import InkBackground from "./InkBackground";
import welcomeImg from "./assets/welcome.png";
import q1FormatImg from "./assets/q1-format.png";
import q2ApproachImg from "./assets/q2-approach.png";
import q3DensityImg from "./assets/q3-density.png";
import q4FocusImg from "./assets/q4-focus.png";
import q5ConditionImg from "./assets/q5-condition.png";
import q6LanguageImg from "./assets/q6-language.png";
import q7PaceImg from "./assets/q7-pace.png";
import q8MapImg from "./assets/q8-map.png";
import doneImg from "./assets/q9-done.png";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import type {
  BaselineProfile, FullCognitiveProfile, CognitiveNeed,
  TransformationParams, ChunkSize, SimplificationLevel,
  CaptionSpeed, SummaryFrequency,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import {
  applyTheme, toggleTheme as themeManagerToggle,
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
    title: "How do ideas click for you?",
    subtitle: "Everyone learns differently - what feels most natural?",
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
    title: "How deep do you like to dive?",
    subtitle: "Some want the sparknotes. Some want the full library.",
    options: [
      { icon: "Zap", label: "Keep it sharp and quick", description: "Give me the essentials - I'll dig deeper if I need to.", value: "concise" },
      { icon: "Library", label: "Take me all the way down", description: "I want the full picture, nuance and all.", value: "detailed" },
    ],
  },
  {
    id: "attentionSpan",
    icon: "Timer",
    title: "What's your focus rhythm?",
    subtitle: "Be honest - this helps us match your natural flow.",
    options: [
      { icon: "Zap", label: "Sprint - short intense bursts", description: "I do best with focused sprints under 10 min.", value: "short" },
      { icon: "PersonStanding", label: "Jog - steady and consistent", description: "I can hold focus for 10\u201325 minutes comfortably.", value: "medium" },
      { icon: "Heart", label: "Marathon - deep dive hours", description: "Once I'm in the zone, I can stay there a while.", value: "long" },
      { icon: "Waves", label: "Depends on the day", description: "It really varies \u2014 let's see what works.", value: "medium", skip: true },
    ],
  },
  {
    id: "condition",
    icon: "Brain",
    title: "Does your brain have any quirks?",
    subtitle: "This helps us tailor the experience. Everything's confidential.",
    options: [
      { icon: "Text", label: "Dyslexia", description: "Adjust text formatting and use visual anchors.", value: "dyslexia" },
      { icon: "Feather", label: "ADHD", description: "Shorter chunks, fewer distractions, frequent wins.", value: "adhd" },
      { icon: "Rainbow", label: "Autism / ASD", description: "Clear structure, literal language, predictable layout.", value: "autism" },
      { icon: "Check", label: "None of the above", description: "Standard tuning based on your preferences.", value: "none" },
      { icon: "Smile", label: "Prefer not to say", description: "That's totally okay.", value: "none", skip: true },
    ],
  },
  {
    id: "secondLanguageLearner",
    icon: "Globe",
    title: "Learning in a non-native language?",
    subtitle: "We adjust sentence complexity and captions for you.",
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
      { icon: "HelpCircle", label: "Not sure / It varies", description: "We'll figure it out together.", value: "moderate", skip: true },
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
      { icon: "RefreshCw", label: "A bit of both / Not sure", description: "I'm flexible depending on the topic.", value: "false", skip: true },
    ],
  },
];

const TOTAL_STEPS = QUESTIONS.length;

const QUESTION_IMAGES = [
  q1FormatImg, q2ApproachImg, q3DensityImg, q4FocusImg,
  q5ConditionImg, q6LanguageImg, q7PaceImg, q8MapImg,
];

/* ─── Icon map for rendering ─── */

const ICON_MAP: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
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

const FEEDBACK_MESSAGES: Record<string, string[]> = {
  visual: ["Great eye!", "Visual thinker - love it!"],
  text: ["Words are your superpower!", "Nice, a reader!"],
  "example-first": ["Examples make it stick!", "Perfect approach!"],
  "theory-first": ["Big-picture thinker!", "Love the curiosity!"],
  concise: ["Short and sweet!", "Straight to the point!"],
  detailed: ["Deep diver!", "Details matter!"],
  short: ["Sprint style!", "Go you!"],
  medium: ["Steady and strong!", "Nice rhythm!"],
  long: ["Deep focus mode!", "Marathon mindset!"],
  dyslexia: ["We've got you!", "Let's make it visual!"],
  adhd: ["We'll keep it snappy!", "You're in good hands!"],
  autism: ["Structure is key!", "Let's build clarity!"],
  none: ["Perfect!", "You do you!"],
  true: ["Glad we asked!", "We'll adjust for you!"],
  false: ["Awesome!", "Native language - noted!"],
  slow: ["Careful reader!", "No rush - comprehension first!"],
  moderate: ["Comfortable pace!", "Solid!"],
  fast: ["Speed reader!", "Fast and fluid!"],
};

/* ─── Helpers ─── */

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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

  if (condition === "dyslexia") {
    chunkSize = "small"; simplificationLevel = 3; useVisualAnchors = true;
    if (captionSpeed === "fast") captionSpeed = "normal";
  } else if (condition === "adhd") {
    chunkSize = "small"; summaryFrequency = "high"; useVisualAnchors = true;
  } else if (condition === "autism") {
    simplificationLevel = Math.max(simplificationLevel, 2) as SimplificationLevel;
    useVisualAnchors = true;
  }

  return { chunkSize, simplificationLevel, captionSpeed, useVisualAnchors, summaryFrequency };
}

function generateProfileSummary(baseline: BaselineProfile, condition?: string): string {
  const parts: string[] = [];

  if (baseline.formatPreference === "visual") {
    parts.push("You learn best visually \u2014 we'll use diagrams, images, and charts to help concepts click");
  } else {
    parts.push("You prefer text-based learning \u2014 we'll keep things clear and well-written");
  }

  if (baseline.attentionSpan === "short") {
    parts.push("with short, focused bursts to match your sprint-style focus");
  } else if (baseline.attentionSpan === "long") {
    parts.push("and we'll give you room for deep, extended dives");
  }

  if (condition === "dyslexia") {
    parts.push("We've adjusted formatting with visual anchors and chunked reading to support your flow");
  } else if (condition === "adhd") {
    parts.push("We'll keep content snappy and rewarding with frequent checkpoints");
  } else if (condition === "autism") {
    parts.push("Expect clear structure, literal language, and consistent layouts throughout");
  }

  if (baseline.secondLanguageLearner) {
    parts.push("Since you're learning in a second language, we'll keep sentences clear and captions paced");
  }

  if (baseline.readingPace === "slow") {
    parts.push("We'll move at a comfortable pace with extra simplification when needed");
  } else if (baseline.readingPace === "fast") {
    parts.push("We'll keep the pace moving to match your reading speed");
  }

  return parts.join(". ") + ".";
}

/* ─── App component ─── */

function App() {
  const [step, setStep] = useState(-1); // -1 = welcome, 0..7 = questions, 8 = done
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [isEditMode, setIsEditMode] = useState(false);
  const [existingProfile, setExistingProfile] = useState<FullCognitiveProfile | null>(null);

  useEffect(() => {
    applyTheme("light");
    setTheme("light");
    const params = new URLSearchParams(window.location.search);
    const edit = params.get("edit") === "1";
    setIsEditMode(edit);

    if (edit) {
      browser.storage.local.get(STORAGE_KEYS.PROFILE).then((result) => {
        const profile = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
        if (!profile) return;
        setExistingProfile(profile);
        setAnswers({
          formatPreference: profile.baseline.formatPreference,
          attentionSpan: profile.baseline.attentionSpan,
          readingPace: profile.baseline.readingPace,
          needsConceptAnchor: profile.baseline.needsConceptAnchor ? "true" : "false",
          secondLanguageLearner: profile.baseline.secondLanguageLearner ? "true" : "false",
          infoDensity: profile.baseline.infoDensity ?? "detailed",
          learningApproach: profile.baseline.learningApproach ?? "theory-first",
          ...(profile.condition && profile.condition !== "multilingual" && profile.condition !== "none"
            ? { condition: profile.condition }
            : {}),
        });
      }).catch(() => {});
    }
  }, []);

  const toggleThemeLocal = useCallback(async () => {
    const next = await themeManagerToggle();
    setTheme(next);
  }, []);

  const selectOption = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    const msgs = FEEDBACK_MESSAGES[value];
    if (msgs) {
      setFeedback(msgs[Math.floor(Math.random() * msgs.length)]);
      setTimeout(() => setFeedback(null), 2000);
    }
  }, []);

  const goNext = useCallback(async () => {
    if (step < 0) { setStep(0); return; }
    const q = QUESTIONS[step];
    if (!answers[q.id]) return;
    if (step === TOTAL_STEPS - 1) {
      await saveProfile();
      setStep(TOTAL_STEPS);
    } else {
      setStep((s) => s + 1);
    }
  }, [step, answers]);

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

    if (isEditMode && existingProfile) {
      const profile: FullCognitiveProfile = {
        ...existingProfile,
        learningStyle: baseline.formatPreference === "visual" ? "visual" : "text",
        attentionSpan: baseline.attentionSpan,
        anchorNeed: baseline.needsConceptAnchor,
        condition: mappedCondition,
        updatedAt: Date.now(),
        baseline, transformationParams: params,
      };
      try { await browser.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile }); }
      catch { console.warn("[MindEase] Profile update failed"); }
      try { await browser.runtime.sendMessage({ type: "PROFILE_UPDATED", payload: profile }); }
      catch { /* ok */ }
      return;
    }

    const profile = {
      userId: generateUUID(),
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

    try { await browser.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile, [STORAGE_KEYS.ONBOARDING_DONE]: true }); }
    catch { console.warn("[MindEase] Profile save failed"); }
    try { await browser.runtime.sendMessage({ type: "ONBOARDING_COMPLETE" }); }
    catch { /* ok */ }
  }

  const progressPct = step < 0 ? 0 : step >= TOTAL_STEPS ? 100 : ((step + 1) / TOTAL_STEPS) * 100;
  const progressLabel = step < 0 ? "Welcome" : step >= TOTAL_STEPS ? "All done!" : `Question ${step + 1} of ${TOTAL_STEPS}`;
  const showNav = step >= 0 && step < TOTAL_STEPS;

  return (
    <>
      <InkBackground theme={theme} />
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
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="progress-label">{progressLabel}</span>
      </div>

      <div className="card-stage">
        <div className="card">
          {step < 0 && (
            <div className="welcome-screen screen-enter" key="welcome">
              <div className="welcome-illustration"><img src={welcomeImg} alt="MindEase illustration" /></div>
              <div className="welcome-icon"><Brain size={24} /></div>
              <h1 className="welcome-title">Welcome to MindEase</h1>
              <p className="welcome-sub">
                A few quick questions and we'll build a learning experience
                that adapts to <em>your</em> brain. No right answers - just you.
              </p>
              <button className="welcome-cta" onClick={() => setStep(0)}>
                Let's go →
              </button>
            </div>
          )}

          {step >= 0 && step < TOTAL_STEPS && (() => {
            const q = QUESTIONS[step];
            const selectedValue = answers[q.id];
            return (
              <div className="question-screen screen-enter" key={step}>
                <div className="question-illustration"><img src={QUESTION_IMAGES[step]} alt="" /></div>
                <h2 className="question-title"><Icon name={q.icon} /> {q.title}</h2>
                <p className="question-sub">{q.subtitle}</p>
                <div className="options-grid">
                  {q.options.map((opt) => (
                    <div
                      key={opt.value}
                      className={`option-card ${selectedValue === opt.value ? "selected" : ""} ${opt.skip ? "other-option" : ""}`}
                      data-value={opt.value}
                      role="radio"
                      aria-checked={selectedValue === opt.value}
                      onClick={() => selectOption(q.id, opt.value)}
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
                {feedback && <div className="micro-feedback" key={feedback}>{feedback}</div>}
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
                <div className="done-illustration"><img src={doneImg} alt="" /></div>
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
                <button className="btn-start" onClick={() => window.close()}>
                  Start Learning →
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {showNav && (
        <div className="nav-row">
          <button className="btn-back" onClick={goBack}>
            ← Back
          </button>
          <button
            className={`btn-next ${answers[QUESTIONS[step].id] ? "enabled" : ""}`}
            onClick={goNext}
          >
            {step === TOTAL_STEPS - 1 ? "View my profile" : "Continue"}
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

/* ─── Mount ─── */

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
