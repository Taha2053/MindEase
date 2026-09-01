let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeReject: ((error: Error) => void) | null = null;

const getSynth = (): SpeechSynthesis | null => {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
};

/**
 * Read text with the browser's local Web Speech implementation.
 * This works in both Chrome and Firefox without API keys or background audio.
 */
export function speak(text: string): Promise<void> {
  const synth = getSynth();
  const normalized = text.trim();
  if (!synth) return Promise.reject(new Error("Text-to-speech is not supported by this browser."));
  if (!normalized) return Promise.resolve();

  stop();

  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(normalized);
    activeUtterance = utterance;
    activeReject = reject;

    utterance.onend = () => {
      if (activeUtterance === utterance) {
        activeUtterance = null;
        activeReject = null;
      }
      resolve();
    };
    utterance.onerror = (event) => {
      if (activeUtterance === utterance) {
        activeUtterance = null;
        activeReject = null;
      }
      reject(new Error(event.error === "canceled" ? "Speech canceled." : `Speech failed: ${event.error}`));
    };

    synth.speak(utterance);
  });
}

export function stop(): void {
  const synth = getSynth();
  if (activeUtterance && activeReject) {
    activeReject(new Error("Speech canceled."));
  }
  activeUtterance = null;
  activeReject = null;
  synth?.cancel();
}

export const stopPuterTts = stop;
