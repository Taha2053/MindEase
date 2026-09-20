import browser from "webextension-polyfill";
import type { TtsSettings, TtsPlayOptions } from "@/types";
import { STORAGE_KEYS } from "@/types";
import { synthesizePremiumSpeech } from "@/layer1/premiumClient";

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  provider: "browser",
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  autoHighlight: true,
};

let _cachedSettings: TtsSettings | null = null;
let _voices: SpeechSynthesisVoice[] = [];
let _voicesLoaded = false;

// Playback state
let _isPlaying = false;
let _isPaused = false;
let _cancelRequested = false;
let _activeUtterance: SpeechSynthesisUtterance | null = null;
let _activeAudio: HTMLAudioElement | null = null;
let _activeAudioUrl: string | null = null;
let _keepAliveTimer: number | null = null;
let _activeResolve: (() => void) | null = null;
let _activeReject: ((err: Error) => void) | null = null;
const getSynth = (): SpeechSynthesis | null => {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return window.speechSynthesis;
  }
  return null;
};

/**
 * Load available synthesis voices, waiting for voiceschanged if needed.
 */
export async function getVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = getSynth();
  if (!synth) return [];

  const existing = synth.getVoices();
  if (existing && existing.length > 0) {
    _voices = existing;
    _voicesLoaded = true;
    return _voices;
  }

  if (_voicesLoaded && _voices.length > 0) {
    return _voices;
  }

  return new Promise((resolve) => {
    let settled = false;

    const onVoices = () => {
      if (settled) return;
      settled = true;
      _voices = synth.getVoices();
      _voicesLoaded = true;
      resolve(_voices);
    };

    synth.addEventListener("voiceschanged", onVoices, { once: true });

    // Fallback timeout in case voiceschanged never fires
    setTimeout(() => {
      if (!settled) {
        settled = true;
        _voices = synth.getVoices();
        _voicesLoaded = true;
        resolve(_voices);
      }
    }, 400);
  });
}

/**
 * Load TTS settings from browser storage
 */
export async function loadTtsSettings(): Promise<TtsSettings> {
  if (_cachedSettings) return _cachedSettings;
  try {
    const res = await browser.storage.local.get(STORAGE_KEYS.TTS_SETTINGS);
    const saved = res[STORAGE_KEYS.TTS_SETTINGS] as Partial<TtsSettings> | undefined;
    _cachedSettings = { ...DEFAULT_TTS_SETTINGS, ...saved };
  } catch {
    _cachedSettings = { ...DEFAULT_TTS_SETTINGS };
  }
  return _cachedSettings;
}

/**
 * Save TTS settings to browser storage
 */
export async function saveTtsSettings(settings: Partial<TtsSettings>): Promise<TtsSettings> {
  const current = await loadTtsSettings();
  const next: TtsSettings = {
    ...current,
    ...settings,
    rate: Math.max(0.5, Math.min(2.0, settings.rate ?? current.rate)),
    pitch: Math.max(0.5, Math.min(1.5, settings.pitch ?? current.pitch)),
    volume: Math.max(0.0, Math.min(1.0, settings.volume ?? current.volume)),
  };
  _cachedSettings = next;
  try {
    await browser.storage.local.set({ [STORAGE_KEYS.TTS_SETTINGS]: next });
  } catch (err) {
    console.warn("[TTS] Failed to persist TTS settings:", err);
  }
  return next;
}

/**
 * Clean text and split it into natural sentence chunks to prevent browser speech synthesis timeouts.
 */
export function splitIntoSentences(rawText: string): string[] {
  if (!rawText) return [];

  // Remove annotation tags, HTML markup, markdown artifacts
  const clean = rawText
    .replace(/\[\/?(?:CHUNK(?:\s*\d+)?|EXAMPLE(?:_END)?|FORMULA|\/FORMULA)\]/gi, " ")
    .replace(/\[(?:CONCEPT|SUMMARY|DEF):[^\]]+\]/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return [];

  // Split on sentence boundaries
  const rawSentences = clean.split(/(?<=[.!?。！？])\s+/);
  const chunks: string[] = [];

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // If a sentence is very long (>180 chars), split on commas/semicolons/clauses
    if (trimmed.length > 180) {
      const subClauses = trimmed.split(/(?<=[,;:\u2014])\s+/);
      let current = "";
      for (const clause of subClauses) {
        if ((current + " " + clause).trim().length > 180 && current.length > 0) {
          chunks.push(current.trim());
          current = clause;
        } else {
          current = current ? `${current} ${clause}` : clause;
        }
      }
      if (current.trim()) {
        chunks.push(current.trim());
      }
    } else {
      chunks.push(trimmed);
    }
  }

  return chunks.length > 0 ? chunks : [clean];
}

export function groupSpeechText(sentences: string[], maxChars = 4500): string[] {
  const groups: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const parts: string[] = [];
    for (let offset = 0; offset < sentence.length; offset += maxChars) {
      parts.push(sentence.slice(offset, offset + maxChars));
    }
    for (const part of parts) {
      const candidate = current ? `${current} ${part.trim()}` : part.trim();
      if (candidate.length > maxChars && current) {
        groups.push(current);
        current = part.trim();
      } else {
        current = candidate;
      }
    }
  }
  if (current) groups.push(current);
  return groups;
}

function playAudioBlob(blob: Blob, volume: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    _activeAudio = audio;
    _activeAudioUrl = url;
    audio.volume = volume;
    const finish = (error?: Error) => {
      URL.revokeObjectURL(url);
      if (_activeAudio === audio) _activeAudio = null;
      if (_activeAudioUrl === url) _activeAudioUrl = null;
      error ? reject(error) : resolve();
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("Premium speech audio could not be played"));
    audio.play().catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

/**
 * Periodic keep-alive for Chromium browsers to prevent silent speech synthesis cancellation.
 */
function startKeepAlive(synth: SpeechSynthesis): void {
  stopKeepAlive();
  _keepAliveTimer = (setInterval(() => {
    if (synth.speaking && !synth.paused) {
      synth.pause();
      synth.resume();
    }
  }, 10000) as unknown as number);
}

function stopKeepAlive(): void {
  if (_keepAliveTimer) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
  }
}

/**
 * Play a single sentence/utterance with promise resolution.
 */
function speakUtterance(
  synth: SpeechSynthesis,
  text: string,
  settings: TtsSettings,
  voice: SpeechSynthesisVoice | null,
  options?: TtsPlayOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    _activeUtterance = utterance;

    utterance.rate = options?.rate ?? settings.rate;
    utterance.pitch = options?.pitch ?? settings.pitch;
    utterance.volume = options?.volume ?? settings.volume;

    if (voice) {
      utterance.voice = voice;
    } else if (settings.voiceLang || options?.voiceLang) {
      utterance.lang = options?.voiceLang ?? settings.voiceLang ?? "en-US";
    }

    utterance.onstart = () => {
      startKeepAlive(synth);
    };

    utterance.onboundary = (e) => {
      if (options?.onBoundary && typeof e.charIndex === "number") {
        options.onBoundary(e.charIndex, e.charLength);
      }
    };

    utterance.onend = () => {
      _activeUtterance = null;
      resolve();
    };

    utterance.onerror = (event) => {
      _activeUtterance = null;
      if (event.error === "canceled" || event.error === "interrupted" || _cancelRequested) {
        resolve(); // Normal cancellation
      } else {
        const errorMsg = `Speech error: ${event.error}`;
        console.warn("[TTS]", errorMsg);
        reject(new Error(errorMsg));
      }
    };

    synth.speak(utterance);
  });
}

/**
 * Speak full text or array of sentences sequentially with speed/pitch controls and progress events.
 */
export async function speak(
  textOrTexts: string | string[],
  options?: TtsPlayOptions,
): Promise<void> {
  // Stop any active playback first
  stop();
  _cancelRequested = false;
  _isPlaying = true;
  _isPaused = false;

  const settings = await loadTtsSettings();
  const synth = getSynth();
  const voices = await getVoices();

  // Find requested or configured voice
  const targetVoiceUri = options?.voiceURI || settings.voiceURI;
  const targetVoiceName = settings.voiceName;
  let chosenVoice: SpeechSynthesisVoice | null = null;

  if (targetVoiceUri) {
    chosenVoice = voices.find((v) => v.voiceURI === targetVoiceUri) ?? null;
  }
  if (!chosenVoice && targetVoiceName) {
    chosenVoice = voices.find((v) => v.name === targetVoiceName) ?? null;
  }
  if (!chosenVoice) {
    // Default to natural sounding default voice for current language or en
    const lang = options?.voiceLang || settings.voiceLang || "en";
    chosenVoice = voices.find((v) => v.lang.startsWith(lang) && v.default) ||
                  voices.find((v) => v.lang.startsWith(lang)) ||
                  voices.find((v) => v.lang.startsWith("en")) ||
                  voices[0] ||
                  null;
  }

  // Prepare sentences
  let sentences: string[] = [];
  if (Array.isArray(textOrTexts)) {
    sentences = textOrTexts.flatMap(splitIntoSentences).filter(Boolean);
  } else {
    sentences = splitIntoSentences(textOrTexts);
  }

  if (sentences.length === 0) {
    _isPlaying = false;
    options?.onEnd?.();
    return Promise.resolve();
  }

  options?.onStart?.();

  if (settings.provider === "azure") {
    try {
      const groups = groupSpeechText(sentences);
      for (const [index, group] of groups.entries()) {
        if (_cancelRequested || !_isPlaying) break;
        options?.onProgress?.(index, groups.length, group);
        await playAudioBlob(await synthesizePremiumSpeech(group), options?.volume ?? settings.volume);
      }
      _isPlaying = false;
      _isPaused = false;
      options?.onEnd?.();
      return;
    } catch (error) {
      console.warn("[TTS] Premium speech failed; using the browser voice.", error);
    }
  }

  if (!synth) {
    const err = new Error("Text-to-speech is not supported in this browser.");
    _isPlaying = false;
    options?.onError?.(err);
    return Promise.reject(err);
  }

  return new Promise<void>((resolve, reject) => {
    _activeResolve = resolve;
    _activeReject = reject;

    (async () => {
      try {
        for (let i = 0; i < sentences.length; i++) {
          if (_cancelRequested || !_isPlaying) {
            break;
          }

          options?.onProgress?.(i, sentences.length, sentences[i]);
          await speakUtterance(synth, sentences[i], settings, chosenVoice, options);
        }
        stopKeepAlive();
        _isPlaying = false;
        _isPaused = false;
        options?.onEnd?.();
        resolve();
      } catch (err) {
        stopKeepAlive();
        _isPlaying = false;
        _isPaused = false;
        const error = err instanceof Error ? err : new Error(String(err));
        options?.onError?.(error);
        reject(error);
      } finally {
        _activeResolve = null;
        _activeReject = null;
      }
    })();
  });
}

/**
 * Pause current speech playback
 */
export function pause(): void {
  if (_activeAudio && !_activeAudio.paused) {
    _activeAudio.pause();
    _isPaused = true;
    return;
  }
  const synth = getSynth();
  if (synth && synth.speaking && !synth.paused) {
    synth.pause();
    _isPaused = true;
  }
}

/**
 * Resume paused speech playback
 */
export function resume(): void {
  if (_activeAudio && _activeAudio.paused) {
    void _activeAudio.play();
    _isPaused = false;
    return;
  }
  const synth = getSynth();
  if (synth && synth.paused) {
    synth.resume();
    _isPaused = false;
  }
}

/**
 * Stop speech playback immediately and reset state.
 */
export function stop(): void {
  const synth = getSynth();
  _cancelRequested = true;
  _isPlaying = false;
  _isPaused = false;
  stopKeepAlive();

  if (_activeReject) {
    _activeReject = null;
  }
  if (_activeResolve) {
    _activeResolve = null;
  }
  _activeUtterance = null;
  if (_activeAudio) {
    _activeAudio.pause();
    _activeAudio.src = "";
    _activeAudio = null;
  }
  if (_activeAudioUrl) {
    URL.revokeObjectURL(_activeAudioUrl);
    _activeAudioUrl = null;
  }

  if (synth) {
    synth.cancel();
  }
}

export function isSpeaking(): boolean {
  const synth = getSynth();
  return _isPlaying || (synth ? synth.speaking : false);
}

export function isPaused(): boolean {
  const synth = getSynth();
  return _isPaused || (synth ? synth.paused : false);
}
