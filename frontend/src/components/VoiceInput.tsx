import { AlertTriangle, CornerDownLeft, X } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranscriber } from "../hooks/useTranscriber";
import { MicButton } from "./MicButton";

export type InputMode = "voice" | "text";

function clock(s: number) {
  const n = Math.floor(s);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/**
 * Speak or type. Speech is transcribed by Gnani Prisma (server-side) and dropped into the text box so
 * the player can check and edit it before sending. Typing always works, even when voice is unavailable.
 */
export function VoiceInput({
  onSubmit,
  sessionId,
  purpose = "question",
  placeholder = "Ask a question, or press the mic and speak…",
  submitLabel = "Ask",
  disabled = false,
  allowEmpty = false,
  leading,
  extraAction,
  initialText = "",
}: {
  onSubmit: (text: string, mode: InputMode) => Promise<void> | void;
  sessionId?: string;
  purpose?: "question" | "accusation" | "check";
  placeholder?: string;
  submitLabel?: string;
  disabled?: boolean;
  /** Allow sending with no text (e.g. evidence is attached). */
  allowEmpty?: boolean;
  /** Rendered above the input row (e.g. the attached evidence chip). */
  leading?: ReactNode;
  /** Extra button rendered next to the mic (e.g. "show evidence"). */
  extraAction?: ReactNode;
  /** Pre-fill the box (remount with a new key to change it). */
  initialText?: string;
}) {
  const mic = useTranscriber({ sessionId, purpose });
  const { voice, sttReady, phase, transcribing, error, setError } = mic;
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<InputMode>("text");
  const [sending, setSending] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const rec = { level: mic.level, elapsed: mic.elapsed, maxSeconds: mic.maxSeconds, cancel: mic.cancel };

  async function toggleMic() {
    const transcript = await mic.toggle();
    if (!transcript) return;
    setText((t) => (t.trim() ? `${t.trim()} ${transcript}` : transcript));
    setMode("voice");
    requestAnimationFrame(() => textRef.current?.focus());
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if ((!t && !allowEmpty) || sending || disabled) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(t, mode);
      setText("");
      setMode("text");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const recording = mic.recording;

  return (
    <form onSubmit={submit} className="panel p-3 sm:p-4">
      {leading}
      <div className="flex items-end gap-2 sm:gap-3">
        <MicButton phase={phase} level={rec.level} onClick={toggleMic} />
        {!recording && extraAction}

        <div className="min-w-0 flex-1">
          {recording ? (
            <div className="flex h-14 items-center gap-3 px-1" aria-live="polite">
              <LevelBars level={rec.level} />
              <span className="font-mono text-sm text-paper tabular-nums">
                {clock(rec.elapsed)} <span className="text-smoke-400">/ {clock(rec.maxSeconds)}</span>
              </span>
              <span className="hidden text-xs text-smoke-400 sm:inline">Listening… tap ■ to finish, Esc to cancel</span>
              <button
                type="button"
                onClick={rec.cancel}
                className="ml-auto p-1 text-smoke-400 hover:text-paper"
                aria-label="Cancel recording"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              maxLength={1000}
              disabled={transcribing || disabled}
              placeholder={transcribing ? "Transcribing…" : placeholder}
              aria-label={placeholder}
              className="block max-h-40 min-h-14 w-full resize-y rounded-sm border border-ink-600 bg-ink-950/70 px-3 py-2.5 text-[15px] text-paper placeholder:text-smoke-400 focus:border-gold-700 focus:outline-none disabled:opacity-60"
            />
          )}
        </div>

        {!recording && (
          <button
            type="submit"
            aria-label={submitLabel}
            disabled={(!text.trim() && !allowEmpty) || sending || transcribing || disabled}
            className="btn-primary h-14 shrink-0 px-4 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
          >
            <span className="hidden sm:inline">{submitLabel}</span>
            <CornerDownLeft className="size-4" />
          </button>
        )}
      </div>

      <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-2 px-1 text-xs">
        {error ? (
          <p role="alert" className="flex items-center gap-1.5 text-blood-400">
            <AlertTriangle className="size-3.5 shrink-0" /> {error}
          </p>
        ) : (
          <p className="text-smoke-400">
            {voice === null
              ? "Checking voice…"
              : !sttReady
                ? "Voice is unavailable right now. Type your question instead."
                : mode === "voice" && text
                  ? "Transcribed. Check it, edit if needed, then press Enter."
                  : "Speak in English or Hinglish, up to 30 seconds. Enter to send, Shift+Enter for a new line."}
          </p>
        )}
      </div>
    </form>
  );
}

function LevelBars({ level }: { level: number }) {
  return (
    <span className="flex h-8 items-center gap-[3px]" aria-hidden="true">
      {[0.5, 0.8, 1, 0.8, 0.5, 0.7, 0.9].map((w, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-blood-400 transition-[height] duration-75"
          style={{ height: `${Math.max(12, Math.min(100, level * w * 140))}%` }}
        />
      ))}
    </span>
  );
}
