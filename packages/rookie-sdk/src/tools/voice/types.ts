/**
 * Voice types for TTS and STT
 */

/** TTS Provider types */
export type TTSProvider = "edge" | "elevenlabs" | "openai";

/** STT Provider types */
export type STTProvider = "whisper-local" | "whisper-api" | "openai";

/** Voice options for TTS */
export interface TTSOptions {
  /** Override the active TTS provider */
  provider?: TTSProvider;
  /** Voice ID or name */
  voice?: string;
  /** Speech rate (0.5 - 2.0) */
  rate?: number;
  /** Pitch (-1.0 - 1.0) */
  pitch?: number;
  /** Volume (0.0 - 1.0) */
  volume?: number;
  /** Output format */
  format?: "mp3" | "wav" | "ogg" | "aac";
  /** Language code */
  language?: string;
}

/** STT options */
export interface STTOptions {
  /** Override the active STT provider */
  provider?: STTProvider;
  /** Language code */
  language?: string;
  /** Enable verbose output */
  verbose?: boolean;
  /** Temperature for sampling (0.0 - 1.0) */
  temperature?: number;
  /** Task type */
  task?: "transcribe" | "translate";
}

/** TTS result */
export interface TTSResult {
  /** Audio data as buffer */
  audio: Buffer;
  /** Format */
  format: string;
  /** Duration in seconds */
  duration?: number;
  /** Provider used */
  provider: TTSProvider;
}

/** STT result */
export interface STTResult {
  /** Transcribed text */
  text: string;
  /** Confidence score (0.0 - 1.0) */
  confidence?: number;
  /** Language detected */
  language?: string;
  /** Duration in seconds */
  duration?: number;
  /** Word-level timestamps if available */
  words?: WordTimestamp[];
  /** Provider used */
  provider: STTProvider;
}

/** Word timestamp for STT */
export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

/** Voice configuration */
export interface VoiceConfig {
  /** Default TTS provider */
  defaultTTSProvider: TTSProvider;
  /** Default STT provider */
  defaultSTTProvider: STTProvider;
  /** ElevenLabs API key */
  elevenLabsApiKey?: string;
  /** OpenAI API key */
  openaiApiKey?: string;
  /** Whisper model path (for local) */
  whisperModelPath?: string;
  /** Default voice */
  defaultVoice?: string;
  /** Cache directory */
  cacheDir?: string;
}

/** Voice event types */
export type VoiceEvent =
  | "tts-start"
  | "tts-progress"
  | "tts-complete"
  | "tts-error"
  | "stt-start"
  | "stt-progress"
  | "stt-complete"
  | "stt-error";

/** Voice event callback */
export type VoiceEventCallback = (event: VoiceEvent, data?: unknown) => void;
