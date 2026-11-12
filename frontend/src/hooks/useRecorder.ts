import { useCallback, useEffect, useRef, useState } from "react";
import { concatChunks, downsample, encodeWav, peak, TARGET_RATE } from "../lib/wav";

export type RecorderState = "idle" | "starting" | "recording";

export interface Recording {
  blob: Blob;
  seconds: number;
  peak: number;
}

// AudioWorklet that forwards raw mic frames to the main thread. Inlined so there's no extra asset.
const WORKLET = `
class McRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("mc-recorder", McRecorder);
`;

function micErrorMessage(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow it in your browser's site settings, or type instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. You can type instead.";
  if (name === "NotReadableError") return "Your microphone is busy in another app.";
  if (!window.isSecureContext) return "Voice needs a secure (https or localhost) connection.";
  return "Couldn't start the microphone. You can type instead.";
}

/**
 * Microphone recorder → 16 kHz mono WAV.
 * - live input level (0..1) for the meter
 * - hard stop at `maxSeconds` (Prisma accepts ≤ 30 s)
 */
export function useRecorder({ maxSeconds = 29 }: { maxSeconds?: number } = {}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const levelRef = useRef(0);
  const startedRef = useRef(0);
  const rafRef = useRef(0);
  const resolveRef = useRef<((r: Recording | null) => void) | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setLevel(0);
    setState("idle");
  }, []);

  const finish = useCallback(
    (keep: boolean) => {
      const ctx = ctxRef.current;
      const rate = ctx?.sampleRate ?? TARGET_RATE;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      teardown();
      const resolve = resolveRef.current;
      resolveRef.current = null;
      if (!resolve) return;
      if (!keep || chunks.length === 0) return resolve(null);
      const pcm = downsample(concatChunks(chunks), rate);
      resolve({ blob: encodeWav(pcm), seconds: pcm.length / TARGET_RATE, peak: peak(pcm) });
    },
    [teardown],
  );

  /** Starts recording. The returned promise resolves with the recording when stop() is called (or null on cancel). */
  const start = useCallback(async (): Promise<Recording | null> => {
    if (state !== "idle") return null;
    setError(null);
    setElapsed(0);
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "mc-recorder");
      const mute = ctx.createGain();
      mute.gain.value = 0; // keep the graph pulling without echoing the mic to speakers
      source.connect(node).connect(mute).connect(ctx.destination);

      chunksRef.current = [];
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        chunksRef.current.push(e.data);
        let sum = 0;
        for (let i = 0; i < e.data.length; i++) sum += e.data[i] * e.data[i];
        levelRef.current = Math.min(1, Math.sqrt(sum / e.data.length) * 4);
      };

      streamRef.current = stream;
      ctxRef.current = ctx;
      startedRef.current = performance.now();
      setState("recording");

      const tick = () => {
        const secs = (performance.now() - startedRef.current) / 1000;
        setElapsed(secs);
        setLevel((prev) => prev * 0.6 + levelRef.current * 0.4);
        if (secs >= maxSeconds) return finish(true);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      return await new Promise<Recording | null>((resolve) => {
        resolveRef.current = resolve;
      });
    } catch (e) {
      teardown();
      setError(micErrorMessage(e));
      return null;
    }
  }, [state, maxSeconds, finish, teardown]);

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false), [finish]);

  useEffect(() => () => finish(false), [finish]);

  return { state, level, elapsed, error, maxSeconds, start, stop, cancel, clearError: () => setError(null) };
}
