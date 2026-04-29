/**
 * Voice commands for Rookie CLI
 * Supports TTS (Text-to-Speech) and STT (Speech-to-Text)
 */

import { Command } from "commander";
import { promises as fs } from "fs";
import { resolve } from "path";
import {
  getTTSEngine,
  getSTTEngine,
  textToSpeech,
  speechToText,
  type TTSOptions,
  type STTOptions,
} from "@rookie/agent-sdk";

export function createVoiceCommand(): Command {
  const voice = new Command("voice")
    .description("Voice commands (TTS/STT)")
    .configureHelp({ showGlobalOptions: true });

  // TTS command
  voice
    .command("tts")
    .description("Text-to-Speech: convert text to audio")
    .argument("<text>", "Text to speak (or @filename to read from file)")
    .option("-o, --output <file>", "Output file path", "output.mp3")
    .option("-p, --provider <provider>", "TTS provider (edge|elevenlabs|openai)", "edge")
    .option("-v, --voice <voice>", "Voice ID")
    .option("-r, --rate <rate>", "Speech rate (0.5-2.0)", parseFloat)
    .option("-l, --language <lang>", "Language code (e.g., en-US, zh-CN)")
    .action(async (text: string, options) => {
      try {
        // Check if reading from file
        if (text.startsWith("@")) {
          const filePath = text.slice(1);
          text = await fs.readFile(filePath, "utf-8");
        }

        console.log(`Converting text to speech using ${options.provider}...`);

        const ttsOptions: TTSOptions = {
          provider: options.provider,
          voice: options.voice,
          rate: options.rate,
          language: options.language,
          format: "mp3",
        };

        const result = await textToSpeech(text, ttsOptions);

        // Save to file
        const outputPath = resolve(options.output);
        await fs.writeFile(outputPath, result.audio);

        console.log(`✓ Audio saved to: ${outputPath}`);
        console.log(`  Format: ${result.format}`);
        if (result.duration) {
          console.log(`  Duration: ${result.duration.toFixed(2)}s`);
        }
      } catch (error) {
        console.error("TTS failed:", error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // STT command
  voice
    .command("stt")
    .description("Speech-to-Text: transcribe audio file")
    .argument("<file>", "Audio file path")
    .option("-p, --provider <provider>", "STT provider (whisper-local|whisper-api)", "whisper-api")
    .option("-l, --language <lang>", "Language code (e.g., en, zh)")
    .option("-t, --translate", "Translate to English (Whisper only)", false)
    .option("-o, --output <file>", "Output file for transcription")
    .action(async (file: string, options) => {
      try {
        const filePath = resolve(file);

        // Check file exists
        try {
          await fs.access(filePath);
        } catch {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }

        console.log(`Transcribing audio using ${options.provider}...`);

        const sttOptions: STTOptions = {
          provider: options.provider,
          language: options.language,
          task: options.translate ? "translate" : "transcribe",
        };

        const result = await speechToText(filePath, sttOptions);

        console.log("\nTranscription:");
        console.log("=".repeat(50));
        console.log(result.text);
        console.log("=".repeat(50));

        if (result.language) {
          console.log(`\nDetected language: ${result.language}`);
        }
        if (result.confidence) {
          console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
        }
        if (result.duration) {
          console.log(`Duration: ${result.duration.toFixed(2)}s`);
        }

        // Save to file if requested
        if (options.output) {
          const outputPath = resolve(options.output);
          await fs.writeFile(outputPath, result.text);
          console.log(`\n✓ Transcription saved to: ${outputPath}`);
        }
      } catch (error) {
        console.error("STT failed:", error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List voices command
  voice
    .command("voices")
    .description("List available voices")
    .option("-p, --provider <provider>", "TTS provider (edge|elevenlabs|openai)", "edge")
    .action(async (options) => {
      try {
        const engine = getTTSEngine();
        const voices = await engine.getVoices(options.provider);

        console.log(`Available voices for ${options.provider}:\n`);
        
        if (voices.length === 0) {
          console.log("No voices available. Check your API key configuration.");
          return;
        }

        for (const voice of voices) {
          console.log(`  ${voice.id}`);
          if (voice.name !== voice.id) {
            console.log(`    Name: ${voice.name}`);
          }
          if (voice.language) {
            console.log(`    Language: ${voice.language}`);
          }
          console.log();
        }
      } catch (error) {
        console.error("Failed to list voices:", error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List languages command
  voice
    .command("languages")
    .description("List supported languages for STT")
    .action(async () => {
      const engine = getSTTEngine();
      const languages = engine.getSupportedLanguages();

      console.log("Supported languages for STT:\n");
      for (const lang of languages) {
        console.log(`  ${lang.code} - ${lang.name}`);
      }
    });

  return voice;
}
