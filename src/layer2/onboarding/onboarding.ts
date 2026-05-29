/* ─── MindEase Onboarding Flow ───
     One question at a time. Generates the
     baseline cognitive profile on completion.
     Accessible, uncluttered, dyslexia/ADHD-friendly.
  ─────────────────────────────────────────── */

import browser from "webextension-polyfill";
import type { BaselineProfile } from "@/types";
import { STORAGE_KEYS } from "@/types";

/* ─── Question Definitions ─── */
interface Question {
  id: keyof BaselineProfile;
  title: string;
  subtitle?: string;
  options: { label: string; value: string }[];
}

const QUESTIONS: Question[] = [
  {
    id: "formatPreference",
    title: "How do you prefer to learn?",
    subtitle: "Do you absorb information better through visuals or text?",
    options: [
      { label: "Visual — diagrams, images, charts", value: "visual" },
      { label: "Text — reading and writing", value: "text" },
    ],
  },
  {
    id: "attentionSpan",
    title: "How long can you stay focused?",
    subtitle: "Roughly, how long can you concentrate before needing a short break?",
    options: [
      { label: "Short — about 15–20 minutes", value: "short" },
      { label: "Medium — about 30–45 minutes", value: "medium" },
      { label: "Long — I can go an hour+", value: "long" },
    ],
  },
  {
    id: "readingPace",
    title: "What's your reading pace?",
    subtitle: "How fast do you typically read educational material?",
    options: [
      { label: "Slow — I read carefully", value: "slow" },
      { label: "Moderate — comfortable pace", value: "moderate" },
      { label: "Fast — I skim and scan quickly", value: "fast" },
    ],
  },
  {
    id: "needsConceptAnchor",
    title: "How do you like new concepts introduced?",
    subtitle: "Some people want the big picture first; others prefer to start with the details.",
    options: [
      { label: "Big picture first — show me the map before the territory", value: "true" },
      { label: "Details first — build up to the big picture", value: "false" },
    ],
  },
  {
    id: "secondLanguageLearner",
    title: "Are you studying in a second language?",
    subtitle: "This helps us adjust reading complexity and captions for you.",
    options: [
      { label: "Yes — I'm learning in a non-native language", value: "true" },
      { label: "No — I'm studying in my primary language", value: "false" },
    ],
  },
];

/* ─── App State ─── */
interface OnboardingState {
  currentStep: number;
  answers: Partial<Record<keyof BaselineProfile, string>>;
}

const state: OnboardingState = {
  currentStep: 0,
  answers: {},
};

/* ─── DOM Helpers ─── */
const $ = (id: string): HTMLElement | null => document.getElementById(id);

function renderStep(): void {
  const question = QUESTIONS[state.currentStep];
  const titleEl = $("title");
  const subtitleEl = $("subtitle");
  const optionsEl = $("options-container");
  const prevBtn = $("prev-btn");
  const nextBtn = $("next-btn");
  const indicatorEl = $("step-indicator");

  if (!titleEl || !subtitleEl || !optionsEl || !prevBtn || !nextBtn || !indicatorEl) return;

  titleEl.textContent = question.title;
  subtitleEl.textContent = question.subtitle ?? "";

  indicatorEl.innerHTML = QUESTIONS
    .map((_, i) => {
      let cls = "step-dot";
      if (i === state.currentStep) cls += " active";
      else if (i < state.currentStep) cls += " completed";
      return `<span class="${cls}" aria-hidden="true"></span>`;
    })
    .join("");

  optionsEl.innerHTML = question.options
    .map(
      (opt, i) =>
        `<label class="option-label">
          <input
            type="radio"
            name="onboarding-option"
            value="${opt.value}"
            ${state.answers[question.id] === opt.value ? "checked" : ""}
            aria-label="${opt.label}"
          />
          <span>${opt.label}</span>
        </label>`
    )
    .join("");

  const nextBtnEl = nextBtn as HTMLButtonElement;
  const prevBtnEl = prevBtn as HTMLButtonElement;

  optionsEl.querySelectorAll<HTMLInputElement>("input[type='radio']").forEach((input) => {
    input.addEventListener("change", () => {
      state.answers[question.id] = input.value;
      nextBtnEl.disabled = false;
    });
  });

  prevBtnEl.disabled = state.currentStep === 0;

  if (state.currentStep === QUESTIONS.length - 1) {
    if (state.answers[question.id]) {
      nextBtnEl.disabled = false;
    }
    nextBtnEl.textContent = "Done ✦";
  } else {
    nextBtnEl.textContent = "Next →";
    nextBtnEl.disabled = !state.answers[question.id];
  }
}

/* ─── Generate UUID ─── */
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ─── Save Profile ─── */
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

  const now = new Date().toISOString();
  const profile = {
    userId: generateUUID(),
    learningStyle: baseline.formatPreference === "visual" ? "visual" as const : "text" as const,
    attentionSpan: baseline.attentionSpan,
    anchorNeed: baseline.needsConceptAnchor,
    condition: (baseline.secondLanguageLearner ? "multilingual" : "none") as "multilingual" | "none",
    updatedAt: Date.now(),
    createdAt: now,
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

/* ─── Bind Navigation ─── */
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
      } catch {
        /* background may not be listening */
      }

      window.close();
      return;
    }

    state.currentStep++;
    renderStep();
  });

  renderStep();
}

document.addEventListener("DOMContentLoaded", init);
