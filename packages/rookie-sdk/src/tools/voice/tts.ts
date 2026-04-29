/**
 * Text-to-Speech (TTS) implementation
 * Supports: Edge TTS (free), ElevenLabs (high quality)
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { TTSOptions, TTSResult, TTSProvider, VoiceConfig } from "./types.js";

/** Default voice configuration */
const DEFAULT_CONFIG: Partial<VoiceConfig> = {
  defaultTTSProvider: "edge",
  defaultVoice: "en-US-AriaNeural",
};

/** Edge TTS voice map */
const EDGE_VOICES: Record<string, string> = {
  "en-US": "en-US-AriaNeural",
  "en-GB": "en-GB-SoniaNeural",
  "zh-CN": "zh-CN-XiaoxiaoNeural",
  "zh-TW": "zh-TW-HsiaoChenNeural",
  "ja-JP": "ja-JP-NanamiNeural",
  "ko-KR": "ko-KR-SunHiNeural",
  "de-DE": "de-DE-KatjaNeural",
  "fr-FR": "fr-FR-DeniseNeural",
  "es-ES": "es-ES-ElviraNeural",
  "it-IT": "it-IT-ElsaNeural",
  "ru-RU": "ru-RU-SvetlanaNeural",
  "pt-BR": "pt-BR-FranciscaNeural",
};

/** TTS Engine */
export class TTSEngine {
  private config: VoiceConfig;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as VoiceConfig;
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const provider = options?.provider || this.config.defaultTTSProvider;

    switch (provider) {
      case "edge":
        return this.synthesizeEdge(text, options);
      case "elevenlabs":
        return this.synthesizeElevenLabs(text, options);
      case "openai":
        return this.synthesizeOpenAI(text, options);
      default:
        throw new Error(`Unsupported TTS provider: ${provider}`);
    }
  }

  /**
   * Synthesize using Edge TTS (free)
   */
  private async synthesizeEdge(text: string, options?: TTSOptions): Promise<TTSResult> {
    const voice = options?.voice || this.getEdgeVoice(options?.language);
    const outputPath = join(tmpdir(), `rookie-tts-${Date.now()}.mp3`);

    try {
      // Use edge-tts Python package if available
      const args = [
        "edge-tts",
        "--voice", voice,
        "--text", text,
        "--write-media", outputPath,
      ];

      if (options?.rate) {
        args.push("--rate", `${(options.rate - 1) * 100}%`);
      }

      await this.runCommand("python3", args);

      const audio = await fs.readFile(outputPath);
      await fs.unlink(outputPath).catch(() => {});

      return {
        audio,
        format: "mp3",
        provider: "edge",
      };
    } catch (error) {
      // Fallback: try using edge-tts via npx
      try {
        await this.runCommand("npx", [
          "edge-tts",
          "--voice", voice,
          "--text", text,
          "--write-media", outputPath,
        ]);

        const audio = await fs.readFile(outputPath);
        await fs.unlink(outputPath).catch(() => {});

        return {
          audio,
          format: "mp3",
          provider: "edge",
        };
      } catch {
        throw new Error(`Edge TTS failed: ${error}`);
      }
    }
  }

  /**
   * Synthesize using ElevenLabs (high quality)
   */
  private async synthesizeElevenLabs(text: string, options?: TTSOptions): Promise<TTSResult> {
    const apiKey = this.config.elevenLabsApiKey;
    if (!apiKey) {
      throw new Error("ElevenLabs API key not configured");
    }

    const voiceId = options?.voice || "21m00Tcm4TlvDq8ikWAM"; // Default voice
    const modelId = "eleven_monolingual_v1";

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: "mp3",
      provider: "elevenlabs",
    };
  }

  /**
   * Synthesize using OpenAI TTS
   */
  private async synthesizeOpenAI(text: string, options?: TTSOptions): Promise<TTSResult> {
    const apiKey = this.config.openaiApiKey;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const voice = options?.voice || "alloy";
    const model = "tts-1";

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: options?.format || "mp3",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: options?.format || "mp3",
      provider: "openai",
    };
  }

  /**
   * Stream TTS audio (for real-time playback)
   */
  async *stream(text: string, options?: TTSOptions): AsyncGenerator<Buffer> {
    const provider = options?.provider || this.config.defaultTTSProvider;

    if (provider === "openai") {
      yield* this.streamOpenAI(text, options);
    } else {
      // For non-streaming providers, yield the full audio
      const result = await this.synthesize(text, options);
      yield result.audio;
    }
  }

  /**
   * Stream from OpenAI
   */
  private async *streamOpenAI(text: string, options?: TTSOptions): AsyncGenerator<Buffer> {
    const apiKey = this.config.openaiApiKey;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const voice = options?.voice || "alloy";

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield Buffer.from(value);
    }
  }

  /**
   * Get available voices for a provider
   */
  async getVoices(provider?: TTSProvider): Promise<Array<{ id: string; name: string; language?: string }>> {
    const p = provider || this.config.defaultTTSProvider;

    switch (p) {
      case "edge":
        return Object.entries(EDGE_VOICES).map(([lang, voice]) => ({
          id: voice,
          name: voice,
          language: lang,
        }));
      case "elevenlabs":
        return this.getElevenLabsVoices();
      case "openai":
        return [
          { id: "alloy", name: "Alloy" },
          { id: "echo", name: "Echo" },
          { id: "fable", name: "Fable" },
          { id: "onyx", name: "Onyx" },
          { id: "nova", name: "Nova" },
          { id: "shimmer", name: "Shimmer" },
        ];
      default:
        return [];
    }
  }

  /**
   * Get ElevenLabs voices
   */
  private async getElevenLabsVoices(): Promise<Array<{ id: string; name: string; language?: string }>> {
    const apiKey = this.config.elevenLabsApiKey;
    if (!apiKey) {
      return [];
    }

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { voices: Array<{ voice_id: string; name: string }> };
    return data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
    }));
  }

  /**
   * Get Edge voice for language
   */
  private getEdgeVoice(language?: string): string {
    if (language && EDGE_VOICES[language]) {
      return EDGE_VOICES[language];
    }
    return EDGE_VOICES["en-US"];
  }

  /**
   * Run a command and return promise
   */
  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: "pipe" });
      let stderr = "";

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", reject);
    });
  }
}

/** Global TTS instance */
let globalTTS: TTSEngine | null = null;

/** Get or create global TTS engine */
export function getTTSEngine(config?: Partial<VoiceConfig>): TTSEngine {
  if (!globalTTS || config) {
    globalTTS = new TTSEngine(config);
  }
  return globalTTS;
}

/** Convenience function for TTS */
export async function textToSpeech(
  text: string,
  options?: TTSOptions & { config?: Partial<VoiceConfig> }
): Promise<TTSResult> {
  const engine = getTTSEngine(options?.config);
  return engine.synthesize(text, options);
}
