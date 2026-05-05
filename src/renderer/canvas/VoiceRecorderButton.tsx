import React, { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceRecordingResult {
  /** Raw audio blob (webm) */
  audioBlob: Blob;
  /** Float32Array audio data for transcription (16kHz mono) */
  float32Data: Float32Array;
}

interface VoiceRecorderButtonProps {
  theme: 'light' | 'dark';
  onRecordingComplete: (result: VoiceRecordingResult) => void;
  onRecordingStart?: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';

const MAX_RECORDING_MS = 5 * 60 * 1000; // 5 minutes

export function VoiceRecorderButton({
  theme,
  onRecordingComplete,
  onRecordingStart,
  onError,
  disabled,
}: VoiceRecorderButtonProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserCtxRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupAudio();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanupAudio = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (analyserCtxRef.current) {
      analyserCtxRef.current.close().catch(() => {});
      analyserCtxRef.current = null;
      analyserNodeRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  // Start waveform animation once recording state is set AND canvas is in DOM.
  // This mirrors the main app approach: canvas is always rendered, waveform
  // starts via effect after the stream is available.
  useEffect(() => {
    if (state !== 'recording') return;
    const stream = streamRef.current;
    const canvas = canvasRef.current;
    if (!stream || !canvas) return;

    const actx = new AudioContext();
    analyserCtxRef.current = actx;
    const source = actx.createMediaStreamSource(stream);
    const analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyserNodeRef.current = analyser;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const bufLen = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufLen);

    // Same params as main UI: 40 bars, 0.7 total width, minBar 3, h*0.75
    const barCount = 40;
    const barGap = 2;
    const totalBarWidth = w * 0.7;
    const barWidth = (totalBarWidth - barGap * (barCount - 1)) / barCount;
    const startX = (w - totalBarWidth) / 2;
    const isDark = theme === 'dark';

    function draw(): void {
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.floor((i + 2) * (bufLen * 0.6) / barCount);
        const val = dataArray[Math.min(binIndex, bufLen - 1)] / 255;
        const minBar = 3;
        const barH = Math.max(minBar, val * (h * 0.75));
        const x = startX + i * (barWidth + barGap);
        const y = (h - barH) / 2;

        const alpha = 0.4 + val * 0.6;
        ctx.fillStyle = isDark
          ? `rgba(248, 113, 113, ${alpha})`
          : `rgba(239, 68, 68, ${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      actx.close().catch(() => {});
      analyserCtxRef.current = null;
      analyserNodeRef.current = null;
    };
  }, [state, theme]);

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;
    setState('starting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (!mountedRef.current) return;

        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (maxTimerRef.current) {
          clearTimeout(maxTimerRef.current);
          maxTimerRef.current = null;
        }

        const chunks = audioChunksRef.current;
        if (chunks.length === 0) {
          setState('idle');
          onError?.('No audio captured');
          return;
        }

        setState('stopping');
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const float32 = await blobToFloat32(blob);
          if (!mountedRef.current) return;
          onRecordingComplete({ audioBlob: blob, float32Data: float32 });
        } catch (err: any) {
          if (mountedRef.current) {
            onError?.(`Audio processing failed: ${err.message}`);
          }
        } finally {
          if (mountedRef.current) setState('idle');
        }
      };

      recorder.start();
      // Setting state to 'recording' triggers the useEffect that starts waveform
      setState('recording');
      onRecordingStart?.();

      maxTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          stopRecording();
        }
      }, MAX_RECORDING_MS);
    } catch (err: any) {
      cleanupAudio();
      if (!mountedRef.current) return;
      setState('idle');
      if (err.name === 'NotAllowedError') {
        onError?.('Microphone access denied');
      } else {
        onError?.(`Mic error: ${err.message}`);
      }
    }
  }, [state, cleanupAudio, onRecordingComplete, onRecordingStart, onError]);

  const stopRecording = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleClick = useCallback(() => {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle') {
      startRecording();
    }
  }, [state, startRecording, stopRecording]);

  const isRecording = state === 'recording';
  const isBusy = state === 'starting' || state === 'stopping';

  return (
    <>
      <div className={`canvas-voice-waveform-bar ${isRecording ? '' : 'hidden'}`} onClick={stopRecording}>
        <canvas ref={canvasRef} className="canvas-voice-waveform" />
        <span className="canvas-voice-waveform-label">click to stop</span>
      </div>
      <div className={`canvas-voice-recorder ${isRecording ? 'hidden' : ''}`}>
        <button
          className="canvas-mic-btn"
          onClick={handleClick}
          disabled={disabled || isBusy}
          title="Record voice clip"
          aria-label="Record voice clip"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1zM4 6.5a.5.5 0 0 1 1 0v1a3 3 0 0 0 6 0v-1a.5.5 0 0 1 1 0v1a4 4 0 0 1-3.5 3.97V13H10a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1h1.5v-1.53A4 4 0 0 1 4 7.5v-1z" />
          </svg>
        </button>
      </div>
    </>
  );
}

async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  audioCtx.close();
  return channelData;
}
