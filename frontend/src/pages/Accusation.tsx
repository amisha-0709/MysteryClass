import { AlertTriangle, Check, Gavel, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { KIND_ICON } from "../components/EvidenceCard";
import { MicButton } from "../components/MicButton";
import { SuspectPortrait } from "../components/SuspectPortrait";
import { useSession } from "../context/SessionContext";
import { useTranscriber } from "../hooks/useTranscriber";

const MAX_EVIDENCE = 10;

// Mirrors backend/app/engine/scoring.py. Shown up front so nothing about the score is a surprise.
const RULES: [string, string, string][] = [
  ["Culprit", "25", "Right person, backed by decisive evidence. A right guess with no proof scores 10."],
  ["Evidence cited", "20", "+5 for each record that proves it. Red herrings cost 2 each."],
  ["Contradictions", "25", "Everything you've proven on the board, minus any wrong-link cost."],
  ["Explanation", "15", "+3 for each part of the method you describe. Halved if you name the wrong person."],
  ["Questioning", "15", "How much you got the suspects to admit."],
  ["Hints", "−3 each", "Already counted from the board."],
];

export default function Accusation() {
  const { state } = useSession();
  const navigate = useNavigate();
  const [suspectId, setSuspectId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [contradiction, setContradiction] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mic = useTranscriber({ sessionId: state.id, purpose: "accusation" });
  const textRef = useRef<HTMLTextAreaElement>(null);

  const accused = state.suspects.find((s) => s.id === suspectId);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setConfirming(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, busy]);
  const claimText = new Map(state.suspects.flatMap((s) => s.claims.map((c) => [c.id, `${s.name.split(" ")[0]}: “${c.text}”`])));
  const ready = suspectId !== null && explanation.trim().length > 0;

  async function dictate() {
    const t = await mic.toggle();
    if (!t) return;
    setExplanation((x) => (x.trim() ? `${x.trim()} ${t}` : t));
    setSpoken(true);
    requestAnimationFrame(() => textRef.current?.focus());
  }

  function toggleEvidence(id: string) {
    setEvidence((ev) => (ev.includes(id) ? ev.filter((e) => e !== id) : ev.length < MAX_EVIDENCE ? [...ev, id] : ev));
  }

  async function submit() {
    if (!suspectId) return;
    setBusy(true);
    setError(null);
    try {
      await api.accuse(state.id, {
        suspect_id: suspectId,
        explanation: explanation.trim(),
        mode: spoken ? "voice" : "text",
        evidence_ids: evidence,
        ...(contradiction ? { contradiction_id: contradiction } : {}),
      });
      navigate(`/results/${state.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The accusation couldn't be filed. Try again.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="animate-rise">
      <p className="eyebrow">Stage 6 · Final accusation</p>
      <h1 className="mt-3 font-display text-4xl font-semibold text-paper sm:text-5xl">Make your case</h1>
      <p className="mt-3 max-w-3xl leading-relaxed text-smoke-300">
        Name the person, explain how they did it, and show what proves it. This is final: once you file it, the case
        closes and the truth is revealed.
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-12">
          {/* 1. Who */}
          <Step n={1} title="Who did it?">
            <div role="radiogroup" aria-label="Suspect" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {state.suspects.map((s) => {
                const on = s.id === suspectId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSuspectId(s.id)}
                    className={`panel overflow-hidden text-left transition ${
                      on ? "border-blood-500 ring-1 ring-blood-500" : "hover:border-ink-600"
                    }`}
                  >
                    <SuspectPortrait suspect={s} className="aspect-[4/5] w-full" />
                    <span className="block p-3">
                      <span className="block font-display text-lg leading-tight text-paper">{s.name}</span>
                      <span className="block text-xs text-smoke-400">{s.role}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Step>

          {/* 2. How */}
          <Step n={2} title="How did they do it?">
            <p className="-mt-2 mb-4 text-sm text-smoke-400">
              Speak or type. Walk through it in order: when they moved, how they got in, what they did with the paper,
              and what they left behind. You can record several times; each recording is added to the end.
            </p>
            <div className="panel p-3 sm:p-4">
              <textarea
                ref={textRef}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                rows={7}
                maxLength={4000}
                disabled={mic.transcribing}
                placeholder={
                  accused ? `How did ${accused.name.split(" ")[0]} do it?` : "Pick a suspect, then explain the method…"
                }
                aria-label="Your explanation"
                className="block w-full resize-y rounded-sm border border-ink-600 bg-ink-950/70 px-3 py-2.5 text-[15px] leading-relaxed text-paper placeholder:text-smoke-400 focus:border-gold-700 focus:outline-none disabled:opacity-60"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <MicButton phase={mic.phase} level={mic.level} onClick={dictate} size={44} />
                <p className="min-w-0 flex-1 text-xs text-smoke-400" aria-live="polite">
                  {mic.recording ? (
                    <span className="text-paper">
                      Recording {Math.floor(mic.elapsed)}s / {mic.maxSeconds}s. Tap ■ to add it, Esc to cancel.
                    </span>
                  ) : mic.transcribing ? (
                    "Transcribing…"
                  ) : mic.error ? (
                    <span className="text-blood-400">{mic.error}</span>
                  ) : mic.sttReady ? (
                    "Dictate in English or Hinglish, up to 30 seconds per recording."
                  ) : (
                    "Voice is unavailable. Type your explanation."
                  )}
                </p>
                <span className="font-mono text-[10px] text-smoke-400">{explanation.length}/4000</span>
              </div>
            </div>
          </Step>

          {/* 3. Proof */}
          <Step n={3} title="What proves it?">
            <p className="-mt-2 mb-4 text-sm text-smoke-400">
              Cite the records that prove your case ({evidence.length}/{MAX_EVIDENCE}). Choose carefully: red herrings
              cost points.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {state.evidence.map((e) => {
                const Icon = KIND_ICON[e.kind];
                const on = evidence.includes(e.id);
                return (
                  <li key={e.id}>
                    <label
                      className={`flex h-full cursor-pointer items-start gap-3 rounded-sm border p-3 text-sm transition ${
                        on ? "border-gold-500 bg-gold-500/10" : "border-ink-700 hover:border-ink-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleEvidence(e.id)}
                        className="mt-1 accent-[var(--color-gold-500)]"
                      />
                      <Icon className="mt-0.5 size-4 shrink-0 text-gold-500" />
                      <span className="min-w-0">
                        <span className="block text-paper">
                          <span className="font-mono text-xs text-gold-400">{e.id}</span> {e.title}
                        </span>
                        <span className="line-clamp-2 text-xs text-smoke-400">{e.summary}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Step>

          {/* 4. Key contradiction */}
          <Step n={4} title="What gave them away?" optional>
            {state.board.found.length === 0 ? (
              <p className="text-sm text-smoke-400">
                You haven't proven any contradictions on the board yet. You can still accuse, but the score counts
                proven contradictions.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Key contradiction" className="space-y-2">
                {state.board.found.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={contradiction === f.id}
                    onClick={() => setContradiction(contradiction === f.id ? null : f.id)}
                    className={`flex w-full items-start gap-3 rounded-sm border p-3 text-left text-sm transition ${
                      contradiction === f.id ? "border-gold-500 bg-gold-500/10" : "border-ink-700 hover:border-ink-600"
                    }`}
                  >
                    <span className="font-mono text-xs text-gold-400">{f.id}</span>
                    <span className="min-w-0 text-smoke-200">
                      {claimText.get(f.claim_id)} <span className="text-smoke-400">vs {f.evidence_id}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Step>
        </div>

        {/* Summary + rules */}
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="panel border-blood-700/60 p-5">
            <p className="eyebrow text-blood-400">Your accusation</p>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Suspect" ok={!!accused} value={accused?.name ?? "Not chosen"} />
              <Row
                label="Explanation"
                ok={explanation.trim().length > 0}
                value={explanation.trim() ? `${explanation.trim().split(/\s+/).length} words${spoken ? " · dictated" : ""}` : "Not written"}
              />
              <Row label="Evidence" ok={evidence.length > 0} value={evidence.length ? evidence.join(", ") : "None cited"} />
              <Row label="Key contradiction" ok value={contradiction ?? "None (optional)"} />
            </dl>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!ready || busy || state.progress.status !== "active"}
              className="btn-primary mt-5 w-full justify-center bg-blood-500 text-paper hover:bg-blood-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Gavel className="size-4" /> File the accusation
            </button>
            {error && (
              <p role="alert" className="mt-3 flex items-start gap-1.5 text-xs text-blood-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
          </div>

          <div className="panel p-5">
            <p className="eyebrow">How it's scored · 100</p>
            <ul className="mt-3 space-y-2.5">
              {RULES.map(([k, pts, rule]) => (
                <li key={k} className="text-xs leading-relaxed text-smoke-400">
                  <span className="text-smoke-200">{k}</span> <span className="font-mono text-gold-400">{pts}</span>
                  <br />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {confirming &&
        accused &&
        createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-h">
          <div className="panel w-full max-w-md border-blood-700 p-6">
            <h2 id="confirm-h" className="font-display text-3xl text-paper">
              Accuse {accused.name}?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-smoke-300">
              This closes the case. You won't be able to question anyone, change the board or edit your answer. The
              truth will be revealed.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="btn-ghost px-4 py-2">
                Not yet
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                autoFocus
                className="btn-primary bg-blood-500 px-4 py-2 text-paper hover:bg-blood-400"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Gavel className="size-4" />} Close the case
              </button>
            </div>
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}

function Step({ n, title, optional, children }: { n: number; title: string; optional?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-5 flex items-baseline gap-3 font-display text-2xl font-semibold text-paper">
        <span className="font-mono text-sm text-gold-500">0{n}</span> {title}
        {optional && <span className="font-sans text-xs font-normal text-smoke-400">Optional</span>}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-gold-400" /> : <X className="mt-0.5 size-4 shrink-0 text-smoke-400" />}
      <div className="min-w-0">
        <dt className="text-xs text-smoke-400">{label}</dt>
        <dd className="break-words text-paper">{value}</dd>
      </div>
    </div>
  );
}

