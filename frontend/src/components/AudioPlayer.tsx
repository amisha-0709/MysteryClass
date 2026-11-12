import { AlertTriangle, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ApiError } from "../api/client";
import { claimPlayback, loadClip, releasePlayback, type LoadedClip } from "../lib/audioClip";

type Phase = "idle" | "loading" | "ready" | "error";

function clock(s: number) {
  if (!Number.isFinite(s)) return "–:––";
  const n = Math.floor(s);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/**
 * Plays one spoken line (Gnani Timbre, generated and cached on the server). Nothing is fetched until the
 * player presses play, so pages never trigger voice generation on load. Only one clip plays at a time.
 */
export function AudioPlayer({
  src,
  label,
  compact = false,
  bars,
  autoPlay = false,
  className = "",
}: {
  src: string;
  label: string; // e.g. "Riya's statement", used for the accessible name
  compact?: boolean;
  bars?: number;
  /** Start playing as soon as it mounts (used for a reply the player just asked for). */
  autoPlay?: boolean;
  className?: string;
}) {
  const nBars = bars ?? (compact ? 28 : 64);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [clip, setClip] = useState<LoadedClip | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wantPlay = useRef(false);

  // Smooth progress while playing (timeupdate only fires ~4×/s).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audioRef.current) setTime(audioRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (el) {
        el.pause();
        releasePlayback(el);
      }
    };
  }, []);

  useEffect(() => {
    if (autoPlay) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureLoaded(): Promise<LoadedClip | null> {
    if (clip) return clip;
    setPhase("loading");
    setError(null);
    try {
      const c = await loadClip(src, nBars);
      setClip(c);
      setPhase("ready");
      return c;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "This recording couldn't be played.");
      setPhase("error");
      return null;
    }
  }

  async function play(from?: number) {
    wantPlay.current = true;
    const c = await ensureLoaded();
    const el = audioRef.current;
    if (!c || !el || !wantPlay.current) return;
    if (el.src !== c.url) el.src = c.url; // set here, not as a JSX prop: a React re-render would reload and abort play()
    if (from !== undefined) el.currentTime = from;
    claimPlayback(el);
    try {
      await el.play();
    } catch {
      /* autoplay or interrupted by another clip */
    }
  }

  function toggle() {
    const el = audioRef.current;
    if (playing && el) {
      wantPlay.current = false;
      el.pause();
    } else if (phase !== "loading") {
      play(el && clip && el.ended ? 0 : undefined);
    }
  }

  function seekTo(fraction: number) {
    const duration = clip?.duration;
    if (!duration) return;
    const t = Math.min(duration, Math.max(0, fraction * duration));
    setTime(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }

  function onWavePointer(e: PointerEvent<HTMLDivElement>) {
    if (!clip) return void play();
    const r = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - r.left) / r.width);
  }

  function onWaveKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!clip) return;
    const step = { ArrowLeft: -5, ArrowRight: 5, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    seekTo((Math.min(clip.duration, Math.max(0, time + step))) / clip.duration);
  }

  const duration = clip?.duration ?? NaN;
  const progress = clip ? time / clip.duration : 0;
  const peaks = clip?.peaks ?? placeholderPeaks(nBars);
  const size = compact ? "size-9" : "size-12";

  return (
    <div className={className}>
      <div className={`flex items-center ${compact ? "gap-2.5" : "gap-4"}`}>
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? "Pause" : "Play"} ${label}`}
          title={`${playing ? "Pause" : "Play"} ${label}`}
          className={`${size} grid shrink-0 place-items-center rounded-full border transition ${
            playing
              ? "border-gold-400 bg-gold-500 text-ink-950"
              : "border-gold-700 bg-ink-900 text-gold-400 hover:border-gold-500 hover:text-gold-300"
          }`}
        >
          {phase === "loading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : playing ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 translate-x-px fill-current" />
          )}
        </button>

        <div
          role="slider"
          tabIndex={clip ? 0 : -1}
          aria-label={`${label} position`}
          aria-valuemin={0}
          aria-valuemax={Math.round(clip?.duration ?? 0)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onPointerDown={onWavePointer}
          onKeyDown={onWaveKey}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-[2px] ${compact ? "h-8" : "h-12"} ${
            phase === "idle" || phase === "error" ? "opacity-50" : ""
          }`}
        >
          {peaks.map((h, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`min-w-[2px] flex-1 rounded-full transition-colors ${
                (i + 0.5) / peaks.length <= progress ? "bg-gold-400" : "bg-ink-600"
              }`}
              style={{ height: `${Math.max(8, h * 100)}%` }}
            />
          ))}
        </div>

        <span className="shrink-0 font-mono text-[11px] text-smoke-400 tabular-nums">
          {clip ? `${clock(time)} / ${clock(duration)}` : phase === "loading" ? "Loading…" : clock(NaN)}
        </span>

        {!compact && clip && (
          <button
            type="button"
            onClick={() => play(0)}
            aria-label={`Replay ${label}`}
            title="Replay from the start"
            className="shrink-0 p-1 text-smoke-400 transition hover:text-paper"
          >
            <RotateCcw className="size-4" />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-blood-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          {error}
          <button type="button" onClick={() => play()} className="ml-1 underline hover:text-paper">
            Retry
          </button>
        </p>
      )}

      <audio
          ref={audioRef}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            if (clip) setTime(clip.duration);
            if (audioRef.current) releasePlayback(audioRef.current);
          }}
        />
    </div>
  );
}

function placeholderPeaks(n: number) {
  return Array.from({ length: n }, (_, i) => 0.18 + 0.12 * Math.abs(Math.sin(i * 1.7)));
}
