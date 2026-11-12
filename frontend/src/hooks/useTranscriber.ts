import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { MicPhase } from "../components/MicButton";
import { useRecorder } from "./useRecorder";
import { useVoiceStatus } from "./useVoiceStatus";

const MIN_SECONDS = 0.4;
const SILENCE_PEAK = 0.012;

/**
 * Mic → local checks → Gnani Prisma transcript. Shared by the question box and the accusation editor.
 * `toggle()` starts a recording, or stops it and resolves with the transcript (null if nothing usable).
 */
export function useTranscriber({
  sessionId,
  purpose,
}: {
  sessionId?: string;
  purpose: "question" | "accusation" | "check";
}) {
  const voice = useVoiceStatus();
  const rec = useRecorder({ maxSeconds: Math.min(29, (voice?.max_seconds ?? 30) - 1) });
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sttReady = voice?.stt === true;
  const phase: MicPhase = !sttReady
    ? "unavailable"
    : transcribing
      ? "transcribing"
      : rec.state === "recording"
        ? "recording"
        : rec.state === "starting"
          ? "starting"
          : "idle";

  useEffect(() => {
    if (rec.error) setError(rec.error);
  }, [rec.error]);

  // Esc cancels an in-progress recording.
  useEffect(() => {
    if (rec.state !== "recording") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && rec.cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rec.state, rec.cancel]);

  async function toggle(): Promise<string | null> {
    if (rec.state === "recording") {
      rec.stop();
      return null; // the pending start() call below resolves with the transcript
    }
    setError(null);
    const recording = await rec.start();
    if (!recording) return null;
    if (recording.seconds < MIN_SECONDS) {
      setError("That was too short to catch. Hold the mic a little longer.");
      return null;
    }
    if (recording.peak < SILENCE_PEAK) {
      setError("We couldn't hear anything. Check your microphone and try again.");
      return null;
    }
    setTranscribing(true);
    try {
      const res = await api.transcribe(recording.blob, { sessionId, purpose });
      if (res.empty) {
        setError("We couldn't make out any words. Try again, a little closer to the mic.");
        return null;
      }
      return res.transcript;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Transcription failed. Try again, or type instead.");
      return null;
    } finally {
      setTranscribing(false);
    }
  }

  return {
    voice,
    sttReady,
    phase,
    level: rec.level,
    elapsed: rec.elapsed,
    maxSeconds: rec.maxSeconds,
    recording: rec.state === "recording",
    transcribing,
    error,
    setError,
    toggle,
    cancel: rec.cancel,
  };
}
