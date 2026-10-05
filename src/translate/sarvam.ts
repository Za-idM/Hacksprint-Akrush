import { SarvamAIClient } from "sarvamai";
import { config } from "../config.js";

const client = new SarvamAIClient({
  apiSubscriptionKey: config.sarvamApiKey,
});

const RETRIES = 2;
const RETRY_DELAY_MS = 1500;

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.warn(`[sarvam] ${label} failed (attempt ${i + 1}/${RETRIES + 1}):`, e);
      if (i < RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface TranslateResult {
  text: string;
  sourceLanguageCode: string;
}

export async function translateText(
  input: string,
  sourceLanguageCode: string,
  targetLanguageCode: string
): Promise<TranslateResult> {
  if (!input.trim()) return { text: input, sourceLanguageCode };
  if (sourceLanguageCode === targetLanguageCode) {
    return { text: input, sourceLanguageCode };
  }

  return withRetry("translate", async () => {
    const res = await client.text.translate({
      input: input.slice(0, 1000),
      source_language_code: sourceLanguageCode as any,
      target_language_code: targetLanguageCode as any,
      model: "mayura:v1",
      mode: "modern-colloquial",
      numerals_format: "international",
    });
    return {
      text: res.translated_text,
      sourceLanguageCode: res.source_language_code ?? sourceLanguageCode,
    };
  });
}

export async function detectAndTranslateToEnglish(input: string): Promise<TranslateResult> {
  if (!input.trim()) return { text: input, sourceLanguageCode: config.defaultLanguageCode };
  // mayura:v1 supports 'auto' source detection
  const res = await translateText(input, "auto", "en-IN");
  return res;
}

export interface VoiceTranscript {
  text: string;
  languageCode: string;
}

export async function transcribeVoiceNote(audio: Buffer): Promise<VoiceTranscript> {
  return withRetry("speech-to-text", async () => {
    // saaras:v3 mode=translate converts Indic speech directly to English
    const blob = new Blob([audio]);
    const res = await client.speechToText.transcribe({
      file: blob,
      model: "saaras:v3",
      mode: "translate" as any,
      language_code: "unknown",
    });
    return {
      text: res.transcript ?? "",
      languageCode: res.language_code ?? config.defaultLanguageCode,
    };
  });
}

// bulbul:v3 supported TTS languages (11 major + English)
const TTS_LANGUAGES = new Set([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN",
  "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
]);

export async function speakText(text: string, languageCode: string): Promise<Buffer | null> {
  if (!text.trim()) return null;
  if (!TTS_LANGUAGES.has(languageCode)) {
    console.warn(`[sarvam] TTS not supported for ${languageCode}; skipping voice reply.`);
    return null;
  }

  return withRetry("text-to-speech", async () => {
    const res = await client.textToSpeech.convert({
      text: text.slice(0, 2500),
      language_code: languageCode as any,
      model: "bulbul:v3",
      speaker: "shubh",
      speech_sample_rate: 16000,
      output_audio_codec: "wav",
    });
    if (!res.audios || res.audios.length === 0) return null;
    return Buffer.from(res.audios.join(""), "base64");
  });
}
