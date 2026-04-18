import { pipeline, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { app } from 'electron';
import * as path from 'path';

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let loading = false;

const MODEL_ID = 'onnx-community/whisper-tiny.en';

async function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriber) return transcriber;
  if (loading) {
    // Wait for existing load to finish
    while (loading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return transcriber!;
  }

  loading = true;
  console.log('[voice] Loading Whisper model...');

  try {
    const cacheDir = path.join(app.getPath('userData'), 'models');
    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      cache_dir: cacheDir,
      dtype: 'q8',
    }) as AutomaticSpeechRecognitionPipeline;
    console.log('[voice] Model loaded');
    return transcriber;
  } finally {
    loading = false;
  }
}

export async function transcribeAudio(audioBuffer: Float32Array): Promise<string> {
  const asr = await getTranscriber();
  const result = await asr(audioBuffer, {
    language: 'en',
    return_timestamps: false,
  });

  // Result can be a single object or array
  if (Array.isArray(result)) {
    return result.map((r: any) => r.text).join(' ').trim();
  }
  return (result as any).text?.trim() || '';
}

// Pre-load model in background
export function preloadModel(): void {
  getTranscriber().catch(err => {
    console.error('[voice] Failed to preload model:', err);
  });
}
