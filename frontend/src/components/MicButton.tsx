import { Loader2, Mic, MicOff, Square } from "lucide-react";

export type MicPhase = "idle" | "starting" | "recording" | "transcribing" | "unavailable";

/** Round mic control. Its ring grows with the live input level while recording. */
export function MicButton({
  phase,
  level,
  onClick,
  size = 56,
}: {
  phase: MicPhase;
  level: number;
  onClick: () => void;
  size?: number;
}) {
  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "transcribing";
  const label = {
    idle: "Start recording your question",
    starting: "Starting microphone",
    recording: "Stop recording",
    transcribing: "Transcribing",
    unavailable: "Voice unavailable, type instead",
  }[phase];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || phase === "unavailable"}
      aria-label={label}
      aria-pressed={recording}
      title={label}
      className="relative grid shrink-0 place-items-center rounded-full transition disabled:cursor-not-allowed"
      style={{ width: size, height: size }}
    >
      {/* level ring */}
      {recording && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-blood-500/30 transition-transform duration-75"
          style={{ transform: `scale(${1 + level * 0.55})` }}
        />
      )}
      <span
        className={`relative grid size-full place-items-center rounded-full border transition ${
          recording
            ? "border-blood-400 bg-blood-500 text-paper"
            : phase === "unavailable"
              ? "border-ink-600 bg-ink-850 text-ink-600"
              : "border-gold-700 bg-ink-900 text-gold-400 hover:border-gold-500 hover:text-gold-300"
        }`}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : recording ? (
          <Square className="size-4 fill-current" />
        ) : phase === "unavailable" ? (
          <MicOff className="size-5" />
        ) : (
          <Mic className="size-5" />
        )}
      </span>
    </button>
  );
}
