/**
 * Speech-to-Text (STT) implementation
 * Supports: Whisper (local/API)
 */

import { createReadStream } from "fs";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
// `form-data` is an optional peer dependency used only by the OpenAI Whisper
// HTTP transport. The specifier is obfuscated behind a string so tsc does not
// attempt to resolve the module at compile time; it is declared external in
// tsup so the bundle does not require it at install time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FormData: any = await (async () => {
  const spec = "form-data";
  try {
    const mod = await import(/* @vite-ignore */ spec);
    return (mod as { default?: unknown }).default ?? mod;
  } catch {
    return null;
  }
})();
import type { STTOptions, STTResult, VoiceConfig, WordTimestamp } from "./types.js";

/** Default configuration */
const DEFAULT_CONFIG: Partial<VoiceConfig> = {
  defaultSTTProvider: "whisper-api",
};

/** STT Engine */
export class STTEngine {
  private config: VoiceConfig;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as VoiceConfig;
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(audioPath: string, options?: STTOptions): Promise<STTResult> {
    const provider = options?.provider || this.config.defaultSTTProvider;

    switch (provider) {
      case "whisper-local":
        return this.transcribeWhisperLocal(audioPath, options);
      case "whisper-api":
      case "openai":
        return this.transcribeWhisperAPI(audioPath, options);
      default:
        throw new Error(`Unsupported STT provider: ${provider}`);
    }
  }

  /**
   * Transcribe from buffer
   */
  async transcribeBuffer(audioBuffer: Buffer, options?: STTOptions): Promise<STTResult> {
    // Write to temp file
    const tempPath = join(tmpdir(), `rookie-stt-${Date.now()}.wav`);
    await fs.writeFile(tempPath, audioBuffer);

    try {
      const result = await this.transcribe(tempPath, options);
      return result;
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  /**
   * Transcribe using local Whisper
   */
  private async transcribeWhisperLocal(audioPath: string, options?: STTOptions): Promise<STTResult> {
    const modelPath = this.config.whisperModelPath || "base";
    
    // Check if whisper-cli is available
    const args = [
      "whisper-cli",
      "--model", modelPath,
      "--file", audioPath,
      "--output-json",
    ];

    if (options?.language) {
      args.push("--language", options.language);
    }

    if (options?.task) {
      args.push("--task", options.task);
    }

    try {
      const output = await this.runCommand("python3", args);
      const result = JSON.parse(output);

      return {
        text: result.text || "",
        language: result.language,
        provider: "whisper-local",
        words: result.segments?.flatMap((s: { words?: WordTimestamp[] }) => s.words || []),
      };
    } catch (error) {
      throw new Error(`Local Whisper failed: ${error}`);
    }
  }

  /**
   * Transcribe using OpenAI Whisper API
   */
  private async transcribeWhisperAPI(audioPath: string, options?: STTOptions): Promise<STTResult> {
    const apiKey = this.config.openaiApiKey;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const formData = new FormData();
    formData.append("file", createReadStream(audioPath));
    formData.append("model", "whisper-1");

    if (options?.language) {
      formData.append("language", options.language);
    }

    if (options?.temperature !== undefined) {
      formData.append("temperature", options.temperature.toString());
    }

    // Request verbose JSON for timestamps
    formData.append("response_format", "verbose_json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      body: formData as unknown as ReadableStream,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI STT error: ${response.status} - ${error}`);
    }

    const result = await response.json() as {
      text: string;
      language?: string;
      duration?: number;
      segments?: Array<{
        text: string;
        start: number;
        end: number;
        words?: WordTimestamp[];
      }>;
    };

    // Extract word timestamps if available
    const words: WordTimestamp[] = [];
    if (result.segments) {
      for (const segment of result.segments) {
        if (segment.words) {
          words.push(...segment.words);
        }
      }
    }

    return {
      text: result.text,
      language: result.language,
      duration: result.duration,
      provider: "whisper-api",
      words: words.length > 0 ? words : undefined,
    };
  }

  /**
   * Translate audio to English (Whisper only)
   */
  async translate(audioPath: string, options?: Omit<STTOptions, "task">): Promise<STTResult> {
    const apiKey = this.config.openaiApiKey;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const formData = new FormData();
    formData.append("file", createReadStream(audioPath));
    formData.append("model", "whisper-1");

    if (options?.temperature !== undefined) {
      formData.append("temperature", options.temperature.toString());
    }

    const response = await fetch("https://api.openai.com/v1/audio/translations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      body: formData as unknown as ReadableStream,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI translation error: ${response.status} - ${error}`);
    }

    const result = await response.json() as { text: string };

    return {
      text: result.text,
      language: "en",
      provider: "whisper-api",
    };
  }

  /**
   * Stream transcription (for real-time)
   * Note: OpenAI doesn't support true streaming, this chunks the audio
   */
  async *streamTranscribe(audioStream: AsyncIterable<Buffer>, options?: STTOptions): AsyncGenerator<STTResult> {
    // Accumulate chunks
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const result = await this.transcribeBuffer(buffer, options);
    yield result;
  }

  /**
   * Check if local Whisper is available
   */
  async isLocalWhisperAvailable(): Promise<boolean> {
    try {
      await this.runCommand("python3", ["-c", "import whisper; print('ok')"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): Array<{ code: string; name: string }> {
    return [
      { code: "en", name: "English" },
      { code: "zh", name: "Chinese" },
      { code: "ja", name: "Japanese" },
      { code: "ko", name: "Korean" },
      { code: "es", name: "Spanish" },
      { code: "fr", name: "French" },
      { code: "de", name: "German" },
      { code: "it", name: "Italian" },
      { code: "pt", name: "Portuguese" },
      { code: "ru", name: "Russian" },
      { code: "ar", name: "Arabic" },
      { code: "hi", name: "Hindi" },
      { code: "pl", name: "Polish" },
      { code: "tr", name: "Turkish" },
      { code: "vi", name: "Vietnamese" },
      { code: "nl", name: "Dutch" },
    ];
  }

  /**
   * Run a command and return stdout
   */
  private runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: "pipe" });
      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", reject);
    });
  }
}

/** Global STT instance */
let globalSTT: STTEngine | null = null;

/** Get or create global STT engine */
export function getSTTEngine(config?: Partial<VoiceConfig>): STTEngine {
  if (!globalSTT || config) {
    globalSTT = new STTEngine(config);
  }
  return globalSTT;
}

/** Convenience function for STT */
export async function speechToText(
  audioPath: string,
  options?: STTOptions & { config?: Partial<VoiceConfig> }
): Promise<STTResult> {
  const engine = getSTTEngine(options?.config);
  return engine.transcribe(audioPath, options);
}

/** Convenience function for STT from buffer */
export async function speechToTextBuffer(
  audioBuffer: Buffer,
  options?: STTOptions & { config?: Partial<VoiceConfig> }
): Promise<STTResult> {
  const engine = getSTTEngine(options?.config);
  return engine.transcribeBuffer(audioBuffer, options);
}
