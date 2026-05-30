import browser from "webextension-polyfill";
import type { BaselineProfile, FullCognitiveProfile } from "@/types";
import { STORAGE_KEYS } from "@/types";

interface Question {
  id: keyof BaselineProfile;
  title: string;
  subtitle?: string;
  options: { icon: string; label: string; description: string; value: string }[];
}

const QUESTIONS: Question[] = [
  {
    id: "formatPreference",
    title: "How do you learn best?",
    subtitle: "Choose the style that feels most natural to you.",
    options: [
      { icon: "\u{1F4CB}", label: "Visual \u2014 Diagrams & Images", description: "Charts, mind maps, illustrations help concepts click.", value: "visual" },
      { icon: "\u{1F4DD}", label: "Text \u2014 Written Explanations", description: "Reading and writing works best for absorbing new ideas.", value: "text" },
    ],
  },
  {
    id: "learningApproach",
    title: "How do you prefer new topics to be introduced?",
    subtitle: "This helps us structure how we present content.",
    options: [
      { icon: "\u{1F4A1}", label: "Examples first", description: "Show me concrete examples, then explain the theory behind them.", value: "example-first" },
      { icon: "\u{1F4D6}", label: "Theory first", description: "Explain the concept first, then show examples to illustrate it.", value: "theory-first" },
    ],
  },
  {
    id: "infoDensity",
    title: "How much detail do you prefer in your learning material?",
    subtitle: "This adjusts content density and chunk size.",
    options: [
      { icon: "\u{1F4A8}", label: "Concise \u2014 Key points only", description: "Short, focused summaries with the essentials.", value: "concise" },
      { icon: "\u{1F4DA}", label: "Detailed \u2014 In-depth explanations", description: "Thorough explanations with all the nuance.", value: "detailed" },
    ],
  },
  {
    id: "attentionSpan",
    title: "How long can you focus before needing a break?",
    subtitle: "Be honest \u2014 this helps us set the right pace.",
    options: [
      { icon: "\u26A1", label: "Short \u2014 Under 10 min", description: "Frequent short bursts keep you sharp.", value: "short" },
      { icon: "\u{1F9D0}", label: "Medium \u2014 10\u201325 min", description: "Solid focus sessions with a breather in between.", value: "medium" },
      { icon: "\u{1F30A}", label: "Long \u2014 25+ minutes", description: "You can dive deep for extended periods.", value: "long" },
    ],
  },
  {
    id: "secondLanguageLearner",
    title: "Are you studying in a language that\u2019s not your native one?",
    subtitle: "We adjust sentence complexity when needed.",
    options: [
      { icon: "\u{1F30D}", label: "Yes \u2014 second language", description: "Simpler sentences and slower captions help.", value: "true" },
      { icon: "\u{1F3F4}", label: "No \u2014 native language", description: "I am comfortable reading in this language.", value: "false" },
    ],
  },
  {
    id: "readingPace",
    title: "How fast do you read and absorb new material?",
    subtitle: "This helps us adjust text density and caption speed.",
    options: [
      { icon: "\u{1F423}", label: "I need to go slow", description: "Careful reading, re-reading key parts.", value: "slow" },
      { icon: "\u{1F43E}", label: "Moderate pace", description: "Comfortable reading through most material.", value: "moderate" },
      { icon: "\u{1F680}", label: "I read quickly", description: "Fast skimmer, good at picking out key points.", value: "fast" },
    ],
  },
  {
    id: "needsConceptAnchor",
    title: "Do you need the big picture before diving into details?",
    subtitle: "How do you prefer new topics to be introduced?",
    options: [
      { icon: "\u{1F30D}", label: "Yes \u2014 start with overview", description: "Show me the map before I explore the terrain.", value: "true" },
      { icon: "\u{1F50D}", label: "No \u2014 details first", description: "Build up to the big picture step by step.", value: "false" },
    ],
  },
];

interface OnboardingState {
  currentStep: number;
  answers: Partial<Record<keyof BaselineProfile, string>>;
  isEditMode: boolean;
  existingProfile: FullCognitiveProfile | null;
}

const state: OnboardingState = {
  currentStep: 0,
  answers: {},
  isEditMode: false,
  existingProfile: null,
};

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/* ─── Theme ─── */

function loadTheme(): void {
  const theme = localStorage.getItem("mindease_theme") ?? "dark";
  document.body.classList.toggle("light", theme === "light");
}

function toggleTheme(): void {
  const isLight = document.body.classList.toggle("light");
  localStorage.setItem("mindease_theme", isLight ? "light" : "dark");
  const btn = $("#theme-toggle");
  if (btn) btn.textContent = isLight ? "\u{1F319}" : "\u2600\uFE0F";
}

/* ─── Render ─── */

function renderStep(): void {
  const question = QUESTIONS[state.currentStep];
  const titleEl = $("title");
  const subtitleEl = $("subtitle");
  const optionsEl = $("options-container");
  const prevBtn = $("prev-btn") as HTMLButtonElement | null;
  const nextBtn = $("next-btn") as HTMLButtonElement | null;
  const indicatorEl = $("step-indicator");
  const stepNumEl = $("step-num");

  if (!titleEl || !subtitleEl || !optionsEl || !prevBtn || !nextBtn || !indicatorEl || !stepNumEl) return;

  stepNumEl.textContent = `STEP ${state.currentStep + 1} OF ${QUESTIONS.length}`;
  titleEl.textContent = question.title;
  subtitleEl.textContent = question.subtitle ?? "";

  indicatorEl.innerHTML = QUESTIONS
    .map((_, i) => {
      let cls = "progress-dot";
      if (i === state.currentStep) cls += " active";
      else if (i < state.currentStep) cls += " done";
      return `<span class="${cls}" aria-hidden="true"></span>`;
    })
    .join("");

  optionsEl.innerHTML = question.options
    .map(
      (opt) => {
        const selected = state.answers[question.id] === opt.value;
        return `
          <div class="option ${selected ? "selected" : ""}" data-value="${opt.value}">
            <div class="option-icon">${opt.icon}</div>
            <div class="option-text">
              <span class="option-label">${opt.label}</span>
              <span class="option-desc">${opt.description}</span>
            </div>
            <div class="option-check">${selected ? "\u2713" : ""}</div>
          </div>
        `;
      }
    )
    .join("");

  optionsEl.querySelectorAll(".option").forEach((el) => {
    el.addEventListener("click", () => {
      state.answers[question.id] = (el as HTMLElement).dataset.value;
      optionsEl.querySelectorAll(".option").forEach((o) => o.classList.remove("selected"));
      optionsEl.querySelectorAll(".option-check").forEach((c) => (c.textContent = ""));
      el.classList.add("selected");
      el.querySelector(".option-check")!.textContent = "\u2713";
      nextBtn.classList.add("enabled");
    });
  });

  prevBtn.disabled = state.currentStep === 0;

  if (state.currentStep === QUESTIONS.length - 1) {
    if (state.answers[question.id]) {
      nextBtn.classList.add("enabled");
    }
    nextBtn.textContent = "Done \u2726";
  } else {
    nextBtn.textContent = "Next \u2192";
    if (state.answers[question.id]) {
      nextBtn.classList.add("enabled");
    } else {
      nextBtn.classList.remove("enabled");
    }
  }
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getTransformationParamsFromBaseline(baseline: BaselineProfile) {
  let chunkSize: "small" | "medium" | "large" = "medium";
  let simplificationLevel: 1 | 2 | 3 = 2;
  let captionSpeed: "slow" | "normal" | "fast" = "normal";
  let useVisualAnchors = true;
  let summaryFrequency: "high" | "medium" | "low" = "medium";

  if (baseline.attentionSpan === "short") {
    chunkSize = "small";
    summaryFrequency = "high";
  } else if (baseline.attentionSpan === "long") {
    chunkSize = "large";
    summaryFrequency = "low";
  }

  if (baseline.formatPreference === "visual") {
    useVisualAnchors = true;
  }

  if (baseline.readingPace === "slow") {
    captionSpeed = "slow";
    simplificationLevel = 3;
  } else if (baseline.readingPace === "fast") {
    captionSpeed = "fast";
    simplificationLevel = 1;
  }

  if (baseline.secondLanguageLearner) {
    const nextLevel = Math.min(3, simplificationLevel + 1) as 1 | 2 | 3;
    simplificationLevel = nextLevel;
    captionSpeed = "slow";
  }

  if (baseline.infoDensity === "concise") {
    chunkSize = chunkSize === "large" ? "medium" : "small";
    summaryFrequency = "high";
  }

  if (baseline.learningApproach === "example-first") {
    useVisualAnchors = true;
    simplificationLevel = Math.min(3, simplificationLevel + 1) as 1 | 2 | 3;
  }

  return { chunkSize, simplificationLevel, captionSpeed, useVisualAnchors, summaryFrequency };
}

function generateProfileSummary(baseline: BaselineProfile): string {
  const parts: string[] = [];

  if (baseline.formatPreference === "visual") {
    parts.push("You learn best through visual content\u2014diagrams, images, and charts help concepts click");
  } else {
    parts.push("You prefer text-based learning\u2014reading and writing work best for absorbing new ideas");
  }

  if (baseline.learningApproach === "example-first") {
    parts.push("and you grasp new topics better when concrete examples come first");
  } else {
    parts.push("and you prefer understanding the theory before seeing examples");
  }

  if (baseline.infoDensity === "concise") {
    parts.push("You like concise, focused summaries that get straight to the point");
  } else {
    parts.push("You appreciate detailed, in-depth explanations with full nuance");
  }

  if (baseline.attentionSpan === "short") {
    parts.push("and shorter, frequent study sessions will help you stay sharp");
  } else if (baseline.attentionSpan === "long") {
    parts.push("and you can dive deep into material for extended periods");
  }

  if (baseline.secondLanguageLearner) {
    parts.push("Since you\u2019re learning in a second language, we\u2019ll keep sentences simple and captions slower");
  }

  if (baseline.needsConceptAnchor) {
    parts.push("We\u2019ll always start with the big picture so you can see where details fit");
  }

  if (baseline.readingPace === "slow") {
    parts.push("and we\u2019ll adjust to a comfortable reading pace with extra simplification");
  } else if (baseline.readingPace === "fast") {
    parts.push("we\u2019ll keep the pace moving to match your reading speed");
  }

  return parts.join(". ") + ".";
}

async function saveProfile(): Promise<void> {
  const baseline: BaselineProfile = {
    formatPreference: state.answers.formatPreference as BaselineProfile["formatPreference"],
    attentionSpan: state.answers.attentionSpan as BaselineProfile["attentionSpan"],
    readingPace: state.answers.readingPace as BaselineProfile["readingPace"],
    needsConceptAnchor: state.answers.needsConceptAnchor === "true",
    secondLanguageLearner: state.answers.secondLanguageLearner === "true",
    infoDensity: state.answers.infoDensity as BaselineProfile["infoDensity"],
    learningApproach: state.answers.learningApproach as BaselineProfile["learningApproach"],
  };

  if (state.isEditMode && state.existingProfile) {
    const profile: FullCognitiveProfile = {
      ...state.existingProfile,
      learningStyle: baseline.formatPreference === "visual" ? "visual" as const : "text" as const,
      attentionSpan: baseline.attentionSpan,
      anchorNeed: baseline.needsConceptAnchor,
      condition: (baseline.secondLanguageLearner ? "multilingual" : "none") as "multilingual" | "none",
      updatedAt: Date.now(),
      baseline,
      transformationParams: getTransformationParamsFromBaseline(baseline),
    };
    await browser.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile });
    try {
      await browser.runtime.sendMessage({ type: "PROFILE_UPDATED", payload: profile });
    } catch { /* ok */ }
    return;
  }

  const profile = {
    userId: generateUUID(),
    learningStyle: baseline.formatPreference === "visual" ? "visual" as const : "text" as const,
    attentionSpan: baseline.attentionSpan,
    anchorNeed: baseline.needsConceptAnchor,
    condition: (baseline.secondLanguageLearner ? "multilingual" : "none") as "multilingual" | "none",
    updatedAt: Date.now(),
    createdAt: new Date().toISOString(),
    baseline,
    rlState: {
      highlightRate: 0,
      pauseRate: 0,
      reReadRate: 0,
      skipRate: 0,
      sessionCount: 0,
      totalEngagementScore: 0,
    },
    transformationParams: getTransformationParamsFromBaseline(baseline),
  };

  await browser.storage.local.set({
    [STORAGE_KEYS.PROFILE]: profile,
    [STORAGE_KEYS.ONBOARDING_DONE]: true,
  });

  try {
    await browser.runtime.sendMessage({ type: "ONBOARDING_COMPLETE" });
  } catch { /* ok */ }
}

function renderCompleteScreen(): void {
  const card = $("card");
  const indicatorEl = $("step-indicator");
  const headerTitle = $("header-title");
  if (!card || !indicatorEl) return;

  const baseline = {
    formatPreference: state.answers.formatPreference as BaselineProfile["formatPreference"],
    attentionSpan: state.answers.attentionSpan as BaselineProfile["attentionSpan"],
    readingPace: state.answers.readingPace as BaselineProfile["readingPace"],
    needsConceptAnchor: state.answers.needsConceptAnchor === "true",
    secondLanguageLearner: state.answers.secondLanguageLearner === "true",
    infoDensity: state.answers.infoDensity as BaselineProfile["infoDensity"],
    learningApproach: state.answers.learningApproach as BaselineProfile["learningApproach"],
  };

  const params = getTransformationParamsFromBaseline(baseline);
  const summary = generateProfileSummary(baseline);

  if (headerTitle) headerTitle.textContent = state.isEditMode ? "Profile Updated" : "You\u2019re all set!";

  indicatorEl.innerHTML = QUESTIONS
    .map(() => `<span class="progress-dot done" aria-hidden="true"></span>`)
    .join("");

  card.innerHTML = `
    <div class="complete-screen">
      <div class="complete-icon">${state.isEditMode ? "\u270F\uFE0F" : "\u{1F9E0}"}</div>
      <div class="complete-title">${state.isEditMode ? "Profile Updated" : "You\u2019re all set!"}</div>
      <div class="profile-summary">${summary}</div>
      <div class="profile-preview">
        <div class="preview-row"><span>Format</span><span>${baseline.formatPreference}</span></div>
        <div class="preview-row"><span>Learning Approach</span><span>${baseline.learningApproach === "example-first" ? "Examples first" : "Theory first"}</span></div>
        <div class="preview-row"><span>Info Density</span><span>${baseline.infoDensity}</span></div>
        <div class="preview-row"><span>Attention</span><span>${baseline.attentionSpan}</span></div>
        <div class="preview-row"><span>Reading Pace</span><span>${baseline.readingPace}</span></div>
        <div class="preview-row"><span>Overview First</span><span>${baseline.needsConceptAnchor ? "Yes" : "No"}</span></div>
        <div class="preview-row"><span>Second Language</span><span>${baseline.secondLanguageLearner ? "Yes" : "No"}</span></div>
        <div class="preview-row"><span>Chunk Size</span><span>${params.chunkSize}</span></div>
        <div class="preview-row"><span>Simplification</span><span>Level ${params.simplificationLevel}</span></div>
      </div>
      <div class="nav" style="justify-content:center">
        <button id="start-btn" class="btn-next enabled" style="padding:12px 40px;font-size:0.95rem">
          ${state.isEditMode ? "Done \u2714" : "Start Learning \u2192"}
        </button>
      </div>
    </div>
  `;

  document.getElementById("start-btn")?.addEventListener("click", () => {
    window.close();
  });
}

/* ─── Init ─── */

async function init(): Promise<void> {
  loadTheme();

  const themeBtn = $("theme-toggle");
  if (themeBtn) {
    const isLight = document.body.classList.contains("light");
    themeBtn.textContent = isLight ? "\u{1F319}" : "\u2600\uFE0F";
    themeBtn.addEventListener("click", toggleTheme);
  }

  const params = new URLSearchParams(window.location.search);
  state.isEditMode = params.get("edit") === "1";

  if (state.isEditMode) {
    const result = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
    const profile = result[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
    if (profile) {
      state.existingProfile = profile;
      state.answers.formatPreference = profile.baseline.formatPreference;
      state.answers.attentionSpan = profile.baseline.attentionSpan;
      state.answers.readingPace = profile.baseline.readingPace;
      state.answers.needsConceptAnchor = profile.baseline.needsConceptAnchor ? "true" : "false";
      state.answers.secondLanguageLearner = profile.baseline.secondLanguageLearner ? "true" : "false";
      state.answers.infoDensity = profile.baseline.infoDensity ?? "detailed";
      state.answers.learningApproach = profile.baseline.learningApproach ?? "theory-first";
    }
    const headerTitle = $("header-title");
    if (headerTitle) headerTitle.textContent = "Edit Profile";
  }

  const prevBtn = $("prev-btn");
  const nextBtn = $("next-btn");

  if (!prevBtn || !nextBtn) return;

  prevBtn.addEventListener("click", () => {
    if (state.currentStep > 0) {
      state.currentStep--;
      renderStep();
    }
  });

  nextBtn.addEventListener("click", async () => {
    const question = QUESTIONS[state.currentStep];
    if (!state.answers[question.id]) return;

    if (state.currentStep === QUESTIONS.length - 1) {
      await saveProfile();
      renderCompleteScreen();
      return;
    }

    state.currentStep++;
    renderStep();
  });

  renderStep();
}

document.addEventListener("DOMContentLoaded", init);
