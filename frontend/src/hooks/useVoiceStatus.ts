import { useEffect, useState } from "react";
import { api, type VoiceStatus } from "../api/client";

let cached: Promise<VoiceStatus> | null = null;

/** Server voice capabilities, fetched once per page load. null while loading; stt=false if unreachable. */
export function useVoiceStatus(): VoiceStatus | null {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    cached ??= api.voiceStatus().catch(() => ({ stt: false, tts: false, stt_model: "", max_seconds: 30 }));
    let live = true;
    cached.then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return status;
}
