/**
 * Backward compatibility bridge for TTS operations.
 * Uses local Web Speech API via ttsManager.
 */
export {
  speak,
  pause,
  resume,
  stop,
  isSpeaking,
  isPaused,
  getVoices,
  loadTtsSettings,
  saveTtsSettings,
  splitIntoSentences,
  DEFAULT_TTS_SETTINGS,
} from "@/utils/ttsManager";

export { stop as stopPuterTts } from "@/utils/ttsManager";
