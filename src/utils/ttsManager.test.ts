import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  splitIntoSentences,
  groupSpeechText,
  loadTtsSettings,
  saveTtsSettings,
  DEFAULT_TTS_SETTINGS,
  isSpeaking,
  isPaused,
  stop,
} from "./ttsManager";

describe("TTS Manager", () => {
  beforeEach(() => {
    stop();
  });

  describe("splitIntoSentences", () => {
    it("returns empty array for empty string", () => {
      expect(splitIntoSentences("")).toEqual([]);
      expect(splitIntoSentences("   ")).toEqual([]);
    });

    it("splits text into sentences by punctuation marks", () => {
      const text = "Gradient descent is an optimization algorithm. It minimizes the loss function! Does it converge?";
      const sentences = splitIntoSentences(text);
      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe("Gradient descent is an optimization algorithm.");
      expect(sentences[1]).toBe("It minimizes the loss function!");
      expect(sentences[2]).toBe("Does it converge?");
    });

    it("strips annotation tags and HTML elements", () => {
      const text = "[CHUNK 1] [CONCEPT: Gradient Descent] <b>Gradient descent</b> optimizes models. [SUMMARY: Minimizes loss]";
      const sentences = splitIntoSentences(text);
      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe("Gradient descent optimizes models.");
    });

    it("splits very long sentences into readable clauses", () => {
      const longSentence = "Machine learning models rely heavily on large collections of training data, which must be carefully curated and preprocessed, so that algorithms can discover meaningful statistical patterns without overfitting to noise, and ultimately generalize well to unseen test samples in real-world deployments.";
      const sentences = splitIntoSentences(longSentence);
      expect(sentences.length).toBeGreaterThan(1);
      for (const s of sentences) {
        expect(s.length).toBeLessThan(200);
      }
    });
  });

  it("groups premium speech below the provider character limit", () => {
    const groups = groupSpeechText(["A".repeat(3000), "B".repeat(3000)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.length <= 4500)).toBe(true);
  });

  describe("Settings & State", () => {
    it("loads default settings when storage is empty", async () => {
      const settings = await loadTtsSettings();
      expect(settings.rate).toBe(DEFAULT_TTS_SETTINGS.rate);
      expect(settings.pitch).toBe(DEFAULT_TTS_SETTINGS.pitch);
      expect(settings.volume).toBe(DEFAULT_TTS_SETTINGS.volume);
    });

    it("saves and clamps updated settings within valid ranges", async () => {
      const updated = await saveTtsSettings({ rate: 3.5, pitch: 0.2 });
      expect(updated.rate).toBe(2.0); // Clamped max
      expect(updated.pitch).toBe(0.5); // Clamped min
    });

    it("reports speaking and paused state correctly", () => {
      expect(isSpeaking()).toBe(false);
      expect(isPaused()).toBe(false);
    });
  });
});
