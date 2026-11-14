import { ChevronDown, FileSearch, Keyboard, Mic, Paperclip, Quote, Sparkles, Volume2, VolumeX, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Evidence, type Suspect, type Turn } from "../api/client";
import { AudioPlayer } from "../components/AudioPlayer";
import { SuspectPortrait } from "../components/SuspectPortrait";
import { VoiceInput, type InputMode } from "../components/VoiceInput";
import { useSession } from "../context/SessionContext";
import { useToast } from "../context/ToastContext";

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
  const notify = useToast();
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

    const prev = state.interrogation[current.id] ?? { asked: 0, slips: 0 };
    setState({
      ...state,
      evidence: [...state.evidence, ...res.new_evidence],
      progress: { ...state.progress, evidence_found: state.progress.evidence_found + res.new_evidence.length },
      interrogation: {
        ...state.interrogation,
        [current.id]: { asked: prev.asked + 1, slips: prev.slips + (res.turn.revealed ? 1 : 0) },
      },
    });

    // Admissions are already marked inline under the reply; only new evidence (which lives on
    // another page) gets a pop-up.
    for (const e of res.new_evidence) {
      notify({
        kind: "evidence",
        title: `New evidence: ${e.title}`,
        body: e.summary,
        to: `/case/${state.case.id}/investigation`,
        action: "Open the evidence locker",
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
            <span className="sm:hidden">
              Ask anything. Use <Paperclip className="inline size-3.5" aria-label="the paperclip" /> to show evidence.
            </span>
            <span className="hidden sm:inline">
              Ask in your own words, by voice or keyboard. Everyone sticks to their story until you prove otherwise,
              so press them, follow up, and <span className="text-paper">show evidence</span> that contradicts what
              they say.
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAutoplay}
          aria-pressed={autoplay}
          className="inline-flex items-center gap-2 rounded-sm border border-ink-600 px-3 py-2 text-xs text-smoke-300 transition hover:border-gold-700 hover:text-paper"
        >
          {autoplay ? <Volume2 className="size-4 text-gold-400" /> : <VolumeX className="size-4" />}
          <span className="sm:hidden">Voice {autoplay ? "on" : "off"}</span>
          <span className="hidden sm:inline">Speak replies aloud: {autoplay ? "on" : "off"}</span>
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:mt-8 sm:gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Suspect picker: four across on phones, a list on desktop */}
        <nav aria-label="Suspects">
          <ul className="grid grid-cols-4 gap-2 lg:flex lg:flex-col lg:gap-3">
            {suspects.map((s) => {
              const active = s.id === current.id;
              const c = state.interrogation[s.id] ?? { asked: 0, slips: 0 };
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => choose(s)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`${s.name}: ${c.asked ? `${c.asked} questions` : "not questioned"}${c.slips ? `, ${c.slips} admissions` : ""}`}
                    className={`flex w-full flex-col items-center gap-1.5 rounded-sm border p-1.5 text-center transition lg:flex-row lg:gap-3 lg:p-2 lg:text-left ${
                      active ? "border-gold-700 bg-ink-850" : "border-ink-700 bg-ink-900/60 hover:border-ink-600"
                    }`}
                  >
                    <span className="relative">
                      <SuspectPortrait
                        suspect={s}
                        className={`size-14 shrink-0 rounded-full lg:size-12 lg:rounded-sm ${active ? "ring-2 ring-gold-500" : ""}`}
                      />
                      {c.slips > 0 && (
                        <span
                          className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-gold-500 font-mono text-[10px] font-bold text-ink-950 lg:hidden"
                          aria-hidden="true"
                        >
                          {c.slips}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 lg:flex-1">
                      <span className={`block truncate text-xs font-medium lg:text-sm ${active ? "text-paper" : "text-smoke-200"}`}>
                        <span className="lg:hidden">{firstName(s)}</span>
                        <span className="hidden lg:inline">{s.name}</span>
                      </span>
                      <span className="hidden font-mono text-[10px] tracking-wider text-smoke-400 uppercase lg:block">
                        {c.asked ? `${c.asked} question${c.asked === 1 ? "" : "s"}` : "Not questioned"}
                        {c.slips ? (
                          <span className="text-gold-400">
                            {" "}
                            · {c.slips} slip{c.slips > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </span>
                      <span className="block font-mono text-[9px] text-smoke-400 lg:hidden">
                        {c.asked ? `${c.asked} asked` : "new"}
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
            <SuspectPortrait suspect={current} className="hidden size-14 shrink-0 rounded-sm sm:block" />
            <div className="min-w-0">
              <h2 className="font-display text-2xl leading-tight text-paper">{current.name}</h2>
              <p className="text-xs text-smoke-400">
                {current.role} · <span className="text-gold-400 italic">{current.personality}</span>
              </p>
            </div>
          </header>
          <Dossier suspect={current} turns={mine} found={state.board.found} />

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

          <div className="sticky bottom-[var(--tabbar-h)] z-20 border-t border-ink-700 bg-ink-900/95 p-3 backdrop-blur sm:p-4 md:bottom-0">
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
                  : `Ask ${firstName(current)}…`
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

/** What we know about this suspect: their claims (struck when proven false) and what they've admitted. */
function Dossier({
  suspect,
  turns,
  found,
}: {
  suspect: Suspect;
  turns: Turn[];
  found: { claim_id: string; evidence_id: string }[];
}) {
  const admissions = turns.filter((t) => t.revealed);
  const broken = new Map(found.map((f) => [f.claim_id, f.evidence_id]));
  return (
    <details className="group border-b border-ink-700">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs text-smoke-300 select-none hover:text-paper [&::-webkit-details-marker]:hidden">
        <span className="eyebrow">Dossier</span>
        <span className="text-smoke-400">
          {suspect.claims.length} claims · {admissions.length} admission{admissions.length === 1 ? "" : "s"}
        </span>
        <ChevronDown className="ml-auto size-4 transition group-open:rotate-180" />
      </summary>
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-smoke-400 uppercase">Their claims</p>
          <ul className="mt-2 space-y-1.5">
            {suspect.claims.map((c) => {
              const ev = broken.get(c.id);
              return (
                <li key={c.id} className="flex gap-2 text-sm">
                  {ev ? (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-blood-400" aria-label="Proven false" />
                  ) : (
                    <Quote className="mt-0.5 size-3.5 shrink-0 text-gold-700" aria-hidden="true" />
                  )}
                  <span className={ev ? "text-smoke-400 line-through decoration-blood-500" : "text-smoke-200"}>
                    {c.text}
                    {ev && <span className="ml-1.5 font-mono text-[10px] text-blood-400 no-underline">vs {ev}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-smoke-400 uppercase">What they've admitted</p>
          {admissions.length ? (
            <ul className="mt-2 space-y-1.5">
              {admissions.map((t) => (
                <li key={t.id} className="flex gap-2 text-sm text-smoke-200">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-gold-400" aria-hidden="true" />
                  <span className="line-clamp-3">{t.reply}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-smoke-400">Nothing yet. They'll hold their story until you show proof.</p>
          )}
        </div>
      </div>
    </details>
  );
}
