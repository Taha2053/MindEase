import browser from "webextension-polyfill";
import type { BaselineProfile } from "@/types";
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
      { icon: "\u{1F4CB}", label: "Visual — Diagrams & Images", description: "Charts, mind maps, illustrations help concepts click.", value: "visual" },
      { icon: "\u{1F4DD}", label: "Text — Written Explanations", description: "Reading and writing works best for absorbing new ideas.", value: "text" },
    ],
  },
  {
    id: "attentionSpan",
    title: "How long can you focus before needing a break?",
    subtitle: "Be honest — this helps us set the right pace.",
    options: [
      { icon: "\u26A1", label: "Short — Under 10 min", description: "Frequent short bursts keep you sharp.", value: "short" },
      { icon: "\u{1F9D0}", label: "Medium — 10\u201325 min", description: "Solid focus sessions with a breather in between.", value: "medium" },
      { icon: "\u{1F30A}", label: "Long — 25+ minutes", description: "You can dive deep for extended periods.", value: "long" },
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
      { icon: "\u{1F30D}", label: "Yes — start with overview", description: "Show me the map before I explore the terrain.", value: "true" },
      { icon: "\u{1F50D}", label: "No — details first", description: "Build up to the big picture step by step.", value: "false" },
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
];

interface OnboardingState {
  currentStep: number;
  answers: Partial<Record<keyof BaselineProfile, string>>;
}

const state: OnboardingState = {
  currentStep: 0,
  answers: {},
};

const $ = (id: string): HTMLElement | null => document.getElementById(id);

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

  return { chunkSize, simplificationLevel, captionSpeed, useVisualAnchors, summaryFrequency };
}

async function saveProfile(): Promise<void> {
  const baseline: BaselineProfile = {
    formatPreference: state.answers.formatPreference as BaselineProfile["formatPreference"],
    attentionSpan: state.answers.attentionSpan as BaselineProfile["attentionSpan"],
    readingPace: state.answers.readingPace as BaselineProfile["readingPace"],
    needsConceptAnchor: state.answers.needsConceptAnchor === "true",
    secondLanguageLearner: state.answers.secondLanguageLearner === "true",
  };

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
}

function renderCompleteScreen(): void {
  const card = $("card");
  const indicatorEl = $("step-indicator");
  if (!card || !indicatorEl) return;

  const baseline = {
    formatPreference: state.answers.formatPreference as BaselineProfile["formatPreference"],
    attentionSpan: state.answers.attentionSpan as BaselineProfile["attentionSpan"],
    readingPace: state.answers.readingPace as BaselineProfile["readingPace"],
    needsConceptAnchor: state.answers.needsConceptAnchor === "true",
    secondLanguageLearner: state.answers.secondLanguageLearner === "true",
  };

  const params = getTransformationParamsFromBaseline(baseline);

  indicatorEl.innerHTML = QUESTIONS
    .map(() => `<span class="progress-dot done" aria-hidden="true"></span>`)
    .join("");

  card.innerHTML = `
    <div class="complete-screen">
      <div class="complete-icon">&#x1F9E0;</div>
      <div class="complete-title">You\u2019re all set!</div>
      <div class="complete-sub">
        Your cognitive profile has been created.<br>
        MindEase will now adapt content to your learning style.
      </div>
      <div class="profile-preview">
        <div class="preview-row"><span>Format</span><span>${baseline.formatPreference}</span></div>
        <div class="preview-row"><span>Attention</span><span>${baseline.attentionSpan}</span></div>
        <div class="preview-row"><span>Reading Pace</span><span>${baseline.readingPace}</span></div>
        <div class="preview-row"><span>Overview First</span><span>${baseline.needsConceptAnchor ? "Yes" : "No"}</span></div>
        <div class="preview-row"><span>Second Language</span><span>${baseline.secondLanguageLearner ? "Yes" : "No"}</span></div>
        <div class="preview-row"><span>Chunk Size</span><span>${params.chunkSize}</span></div>
        <div class="preview-row"><span>Simplification</span><span>Level ${params.simplificationLevel}</span></div>
      </div>
      <div class="nav" style="justify-content:center">
        <button id="start-btn" class="btn-next enabled" style="padding:12px 40px;font-size:0.95rem">
          Start Learning &#x2192;
        </button>
      </div>
    </div>
  `;

  document.getElementById("start-btn")?.addEventListener("click", async () => {
    window.close();
  });
}

function init(): void {
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
      try {
        await browser.runtime.sendMessage({ type: "ONBOARDING_COMPLETE" });
      } catch { /* background may not be listening */ }
      renderCompleteScreen();
      return;
    }

    state.currentStep++;
    renderStep();
  });

  renderStep();
}

document.addEventListener("DOMContentLoaded", init);
