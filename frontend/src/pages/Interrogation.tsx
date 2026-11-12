import { FileSearch, Keyboard, Mic, Paperclip, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Evidence, type Suspect, type Turn } from "../api/client";
import { AudioPlayer } from "../components/AudioPlayer";
import { SuspectPortrait } from "../components/SuspectPortrait";
import { VoiceInput, type InputMode } from "../components/VoiceInput";
import { useSession } from "../context/SessionContext";

// Generic openers only: they never point at a specific secret.
const STARTERS = [
  "Tell me what happened this morning.",
  "Where were you between 8:15 and 8:40?",
  "Did you see anyone on the stairs?",
  "Who do you think did it?",
];

const AUTOPLAY_KEY = "mc.autoplayReplies";

function readAutoplay() {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== "off";
  } catch {
    return true;
  }
}

const firstName = (s: Suspect) => s.name.split(" ")[0];

export default function Interrogation() {
  const { state, setState } = useSession();
  const [params, setParams] = useSearchParams();
  const suspects = state.suspects;
  const current = suspects.find((s) => s.id === params.get("suspect")) ?? suspects[0];

  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attached, setAttached] = useState<Evidence | null>(null);
  const [picking, setPicking] = useState(false);
  const [fresh, setFresh] = useState<{ turnId: number; evidence: Evidence[] } | null>(null);
  const [autoplay, setAutoplay] = useState(readAutoplay);
  const [draft, setDraft] = useState<{ key: number; text: string } | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .turns(state.id)
      .then((t) => !cancelled && setTurns(t))
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [state.id]);

  const mine = useMemo(() => (turns ?? []).filter((t) => t.suspect_id === current.id), [turns, current.id]);
  const counts = useMemo(() => {
    const c: Record<string, { asked: number; slipped: number }> = {};
    for (const t of turns ?? []) {
      c[t.suspect_id] ??= { asked: 0, slipped: 0 };
      c[t.suspect_id].asked++;
      if (t.revealed) c[t.suspect_id].slipped++;
    }
    return c;
  }, [turns]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [mine.length]);

  function choose(s: Suspect) {
    setParams({ suspect: s.id }, { replace: true });
    setAttached(null);
    setPicking(false);
    setFresh(null);
    setDraft(null);
  }

  function toggleAutoplay() {
    const next = !autoplay;
    setAutoplay(next);
    try {
      localStorage.setItem(AUTOPLAY_KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable: the setting just won't persist */
    }
  }

  async function send(question: string, mode: InputMode) {
    const res = await api.ask(state.id, current.id, {
      question,
      mode,
      ...(attached ? { evidence_id: attached.id } : {}),
    });
    setTurns((t) => [...(t ?? []), res.turn]);
    setAttached(null);
    setPicking(false);
    setFresh({ turnId: res.turn.id, evidence: res.new_evidence });
    if (res.new_evidence.length) {
      setState({
        ...state,
        evidence: [...state.evidence, ...res.new_evidence],
        progress: { ...state.progress, evidence_found: state.progress.evidence_found + res.new_evidence.length },
      });
    }
  }

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Stage 4 · Interrogation room</p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-paper sm:text-5xl">Question the suspects</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-smoke-300">
            Ask in your own words, by voice or keyboard. Everyone sticks to their story until you prove otherwise, so
            press them, follow up, and <span className="text-paper">show evidence</span> that contradicts what they
            say.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAutoplay}
          aria-pressed={autoplay}
          className="inline-flex items-center gap-2 rounded-sm border border-ink-600 px-3 py-2 text-xs text-smoke-300 transition hover:border-gold-700 hover:text-paper"
        >
          {autoplay ? <Volume2 className="size-4 text-gold-400" /> : <VolumeX className="size-4" />}
          Speak replies aloud: {autoplay ? "on" : "off"}
        </button>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Suspect picker */}
        <nav aria-label="Suspects" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-3 lg:flex-col">
            {suspects.map((s) => {
              const active = s.id === current.id;
              const c = counts[s.id];
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => choose(s)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-44 items-center gap-3 rounded-sm border p-2 text-left transition lg:w-full ${
                      active ? "border-gold-700 bg-ink-850" : "border-ink-700 bg-ink-900/60 hover:border-ink-600"
                    }`}
                  >
                    <SuspectPortrait suspect={s} className="size-12 shrink-0 rounded-sm" />
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-medium ${active ? "text-paper" : "text-smoke-200"}`}>
                        {s.name}
                      </span>
                      <span className="block font-mono text-[10px] tracking-wider text-smoke-400 uppercase">
                        {c ? `${c.asked} question${c.asked === 1 ? "" : "s"}` : "Not questioned"}
                        {c?.slipped ? (
                          <span className="text-gold-400">
                            {" "}
                            · {c.slipped} slip{c.slipped > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Conversation */}
        <section aria-label={`Interrogation of ${current.name}`} className="panel flex min-h-[520px] min-w-0 flex-col">
          <header className="flex items-center gap-4 border-b border-ink-700 p-4">
            <SuspectPortrait suspect={current} className="size-14 shrink-0 rounded-sm" />
            <div className="min-w-0">
              <h2 className="font-display text-2xl leading-tight text-paper">{current.name}</h2>
              <p className="text-xs text-smoke-400">
                {current.role} · <span className="text-gold-400 italic">{current.personality}</span>
              </p>
            </div>
          </header>

          <div className="flex-1 space-y-5 p-4 sm:p-5" aria-live="polite">
            {loadError && <p className="text-sm text-blood-400">{loadError}</p>}
            {turns === null && !loadError && <p className="text-sm text-smoke-400">Opening the case file…</p>}

            {turns !== null && mine.length === 0 && (
              <div className="py-6 text-center">
                <p className="text-sm text-smoke-400">
                  {firstName(current)} is waiting. Not sure where to start? Try one of these:
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {STARTERS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setDraft({ key: Date.now(), text: q })}
                      className="rounded-full border border-ink-600 px-3 py-1.5 text-xs text-smoke-200 transition hover:border-gold-700 hover:text-paper"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mine.map((t) => (
              <TurnView
                key={t.id}
                turn={t}
                suspect={current}
                sessionId={state.id}
                autoPlay={autoplay && fresh?.turnId === t.id}
                newEvidence={fresh?.turnId === t.id ? fresh.evidence : []}
              />
            ))}
            <div ref={logEnd} className="scroll-mb-56" />
          </div>

          <div className="sticky bottom-0 border-t border-ink-700 bg-ink-900/95 p-3 backdrop-blur sm:p-4">
            {picking && (
              <EvidencePicker
                evidence={state.evidence}
                onPick={(e) => {
                  setAttached(e);
                  setPicking(false);
                }}
                onClose={() => setPicking(false)}
              />
            )}
            <VoiceInput
              key={`${current.id}-${draft?.key ?? 0}`}
              initialText={draft?.text}
              sessionId={state.id}
              purpose="question"
              placeholder={
                attached
                  ? `Show it to ${firstName(current)}, or add a question…`
                  : `Ask ${firstName(current)} a question, or press the mic…`
              }
              submitLabel={attached ? "Show" : "Ask"}
              allowEmpty={attached !== null}
              disabled={state.progress.status !== "active"}
              onSubmit={send}
              extraAction={
                <button
                  type="button"
                  onClick={() => setPicking((p) => !p)}
                  aria-expanded={picking}
                  aria-label="Show evidence to this suspect"
                  title="Show evidence"
                  className={`grid size-11 shrink-0 place-items-center self-center rounded-full border transition sm:size-14 ${
                    attached || picking
                      ? "border-gold-500 bg-gold-500/10 text-gold-300"
                      : "border-ink-600 bg-ink-900 text-smoke-300 hover:border-gold-700 hover:text-paper"
                  }`}
                >
                  <Paperclip className="size-5" />
                </button>
              }
              leading={
                attached && (
                  <div className="mb-3 flex items-center gap-2 rounded-sm border border-gold-700/60 bg-gold-500/5 px-3 py-2 text-sm">
                    <FileSearch className="size-4 shrink-0 text-gold-400" />
                    <span className="min-w-0 flex-1 truncate text-paper">
                      Showing <span className="font-mono text-xs text-gold-400">{attached.id}</span> {attached.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttached(null)}
                      aria-label="Remove evidence"
                      className="p-0.5 text-smoke-400 hover:text-paper"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )
              }
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function TurnView({
  turn: t,
  suspect,
  sessionId,
  autoPlay,
  newEvidence,
}: {
  turn: Turn;
  suspect: Suspect;
  sessionId: string;
  autoPlay: boolean;
  newEvidence: Evidence[];
}) {
  return (
    <div className="space-y-3">
      {/* detective */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-sm border border-ink-600 bg-ink-800 px-4 py-2.5">
          {t.evidence_title && (
            <p className={`flex items-center gap-1.5 text-xs text-gold-400 ${t.question ? "mb-1" : ""}`}>
              <FileSearch className="size-3.5 shrink-0" /> Shows {t.evidence_id}: {t.evidence_title}
            </p>
          )}
          {t.question && (
            <p className="flex items-start gap-2 text-sm text-paper">
              {t.mode === "voice" ? (
                <Mic className="mt-0.5 size-3.5 shrink-0 text-smoke-400" aria-label="Spoken" />
              ) : (
                <Keyboard className="mt-0.5 size-3.5 shrink-0 text-smoke-400" aria-label="Typed" />
              )}
              {t.question}
            </p>
          )}
        </div>
      </div>

      {/* suspect */}
      <div className="flex gap-3">
        <SuspectPortrait suspect={suspect} className="size-9 shrink-0 rounded-full" />
        <div className="max-w-[85%] min-w-0 flex-1">
          <div className="rounded-sm border border-ink-700 bg-ink-950/70 px-4 py-3">
            <p className="font-display text-lg leading-snug text-smoke-200">“{t.reply}”</p>
            <AudioPlayer
              src={api.clipUrl(sessionId, t.clip_id)}
              label={`${firstName(suspect)}'s reply`}
              compact
              bars={36}
              autoPlay={autoPlay}
              className="mt-2"
            />
          </div>
          {t.revealed && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-gold-400">
              <Sparkles className="size-3.5" /> That's new. Worth writing down.
            </p>
          )}
          {newEvidence.map((e) => (
            <p
              key={e.id}
              className="mt-2 flex items-center gap-2 rounded-sm border border-gold-700/60 bg-gold-500/5 px-3 py-2 text-xs text-paper"
            >
              <FileSearch className="size-4 shrink-0 text-gold-400" />
              <span>
                New evidence: <span className="font-mono text-gold-400">{e.id}</span> {e.title}. Added to your
                evidence locker.
              </span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function EvidencePicker({
  evidence,
  onPick,
  onClose,
}: {
  evidence: Evidence[];
  onPick: (e: Evidence) => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-3 rounded-sm border border-ink-600 bg-ink-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow">Show evidence</p>
        <button type="button" onClick={onClose} aria-label="Close" className="p-0.5 text-smoke-400 hover:text-paper">
          <X className="size-4" />
        </button>
      </div>
      <ul className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {evidence.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onPick(e)}
              className="flex w-full items-start gap-2 rounded-sm border border-ink-700 px-3 py-2 text-left text-sm transition hover:border-gold-700"
            >
              <span className="font-mono text-xs text-gold-400">{e.id}</span>
              <span className="min-w-0">
                <span className="block text-paper">{e.title}</span>
                <span className="line-clamp-1 text-xs text-smoke-400">{e.summary}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
