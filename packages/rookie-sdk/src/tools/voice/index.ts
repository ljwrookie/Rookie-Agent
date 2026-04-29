/**
 * Voice module - TTS and STT capabilities
 */

export * from "./types.js";
export * from "./tts.js";
export * from "./stt.js";

import { TTSEngine, getTTSEngine, textToSpeech } from "./tts.js";
import { STTEngine, getSTTEngine, speechToText, speechToTextBuffer } from "./stt.js";
import type { VoiceConfig } from "./types.js";

/** Voice manager combining TTS and STT */
export class VoiceManager {
  public tts: TTSEngine;
  public stt: STTEngine;

  constructor(config?: Partial<VoiceConfig>) {
    this.tts = getTTSEngine(config);
    this.stt = getSTTEngine(config);
  }

  /**
   * Check if voice services are available
   */
  async checkAvailability(): Promise<{
    tts: { edge: boolean; elevenlabs: boolean; openai: boolean };
    stt: { whisperLocal: boolean; whisperAPI: boolean };
  }> {
    const [elevenlabsVoices, openaiTTS, whisperLocal, whisperAPI] = await Promise.all([
      this.tts.getVoices("elevenlabs").then(v => v.length > 0).catch(() => false),
      this.tts.getVoices("openai").then(v => v.length > 0).catch(() => false),
      this.stt.isLocalWhisperAvailable(),
      Promise.resolve(!!this.stt["config"]?.openaiApiKey),
    ]);

    return {
      tts: {
        edge: true, // Always available (free)
        elevenlabs: elevenlabsVoices,
        openai: openaiTTS,
      },
      stt: {
        whisperLocal: whisperLocal,
        whisperAPI: whisperAPI,
      },
    };
  }
}

/** Get voice manager instance */
export function getVoiceManager(config?: Partial<VoiceConfig>): VoiceManager {
  return new VoiceManager(config);
}

// Re-export convenience functions
export { textToSpeech, speechToText, speechToTextBuffer };
