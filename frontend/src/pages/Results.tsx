import { ArrowLeft, Award, CheckCircle2, CircleDashed, Clock, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Resolution, type SessionState } from "../api/client";
import { AudioPlayer } from "../components/AudioPlayer";
import { Logo } from "../components/Logo";
import { SuspectPortrait } from "../components/SuspectPortrait";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/** The case resolution: only reachable once the accusation has closed the case. */
export default function Results() {
  const { sessionId = "" } = useParams();
  const [res, setRes] = useState<Resolution | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle("Case results", res && `Case ${res.case.number}`);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.resolution(sessionId), api.session(sessionId)])
      .then(([r, s]) => {
        if (cancelled) return;
        setRes(r);
        setSession(s);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="atmosphere relative min-h-dvh">
      <div className="relative z-10">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-8">
          <Logo />
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-smoke-300 hover:text-paper">
            <ArrowLeft className="size-4" /> Detective HQ
          </Link>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
          {error && (
            <div className="panel max-w-xl border-blood-700/60 p-8">
              <p className="text-blood-400">{error}</p>
              <Link to="/dashboard" className="btn-ghost mt-6">
                Back to HQ
              </Link>
            </div>
          )}
          {!error && (!res || !session) && <p className="eyebrow animate-pulse">Opening the sealed file…</p>}
          {res && session && <Report res={res} session={session} />}
        </main>
      </div>
    </div>
  );
}

function Report({ res, session }: { res: Resolution; session: SessionState }) {
  const culprit = session.suspects.find((s) => s.id === res.culprit_id);
  const promoted = res.rank_before !== res.rank_after;

  return (
    <div className="animate-rise space-y-16">
      {/* Verdict */}
      <section className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="eyebrow">
            Case {res.case.number} · {res.case.title}
          </p>
          <span className={`stamp mt-5 inline-block ${res.correct ? "" : "opacity-90"}`}>
            {res.correct ? "Case solved" : "Wrong suspect"}
          </span>
          <h1 className="mt-5 max-w-3xl font-display text-4xl leading-tight font-semibold text-paper sm:text-6xl">
            {res.correct
              ? `You were right. It was ${res.culprit_name}.`
              : `You accused ${res.accusation.suspect_name}. It was ${res.culprit_name}.`}
          </h1>
        </div>
        <div className="panel flex items-center gap-6 border-gold-700/70 p-6">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-smoke-400 uppercase">Detective score</p>
            <p className="font-display text-6xl leading-none text-gold-300 tabular-nums">
              {res.score.total}
              <span className="text-2xl text-smoke-400">/100</span>
            </p>
          </div>
          <div className="space-y-1 border-l border-ink-700 pl-6 text-sm">
            <p className="text-paper">+{res.xp_awarded} XP</p>
            {res.xp_awarded < res.xp_earned && (
              <p className="text-xs text-smoke-400">Worth {res.xp_earned}; replays add only the improvement</p>
            )}
            <p className={promoted ? "text-gold-300" : "text-smoke-400"}>
              {promoted ? `Promoted: ${res.rank_after}` : res.rank_after}
            </p>
          </div>
        </div>
      </section>

      {res.new_achievements.length > 0 && (
        <section aria-labelledby="ach-h">
          <h2 id="ach-h" className="flex items-center gap-2 font-display text-2xl text-paper">
            <Award className="size-5 text-gold-500" /> New commendations
          </h2>
          <ul className="mt-4 flex flex-wrap gap-3">
            {res.new_achievements.map((a) => (
              <li key={a.code} className="panel flex items-center gap-3 border-gold-700/60 px-4 py-3">
                <Sparkles className="size-4 text-gold-400" />
                <span>
                  <span className="block text-sm text-paper">{a.title}</span>
                  <span className="block text-xs text-smoke-400">{a.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The truth */}
      <section aria-labelledby="truth-h" className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {culprit && <SuspectPortrait suspect={culprit} className="aspect-[4/5] w-full max-w-[220px] rounded-sm" />}
        <div>
          <h2 id="truth-h" className="font-display text-3xl font-semibold text-paper">
            What really happened
          </h2>
          <AudioPlayer src={api.clipUrl(session.id, res.clip_id)} label="the narrator's account" className="mt-4 max-w-2xl" />
          <p className="mt-5 max-w-3xl font-display text-xl leading-relaxed text-smoke-200 italic">{res.summary}</p>
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-smoke-300">
            <span className="eyebrow mr-2">Motive</span>
            {res.motive}
          </p>
          <ol className="mt-6 max-w-3xl space-y-3">
            {res.method.map((m, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-smoke-200">
                <span className="font-mono text-gold-500">{i + 1}</span>
                {m}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Score */}
      <section aria-labelledby="score-h">
        <h2 id="score-h" className="font-display text-3xl font-semibold text-paper">
          How your reasoning held up
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {res.score.categories.map((c) => (
            <div key={c.id} className="panel p-5">
              <p className="text-sm text-paper">{c.label}</p>
              <p className="mt-1 font-display text-4xl text-gold-300 tabular-nums">{c.percent}%</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full bg-gold-500" style={{ width: `${c.percent}%` }} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-smoke-400">{c.description}</p>
            </div>
          ))}
        </div>
        <ul className="mt-6 divide-y divide-ink-700 rounded-sm border border-ink-700">
          {res.score.components.map((c) => (
            <li key={c.id} className="grid gap-2 p-4 sm:grid-cols-[180px_90px_1fr]">
              <span className="text-sm text-paper">{c.label}</span>
              <span className={`font-mono text-sm tabular-nums ${c.points < 0 ? "text-blood-400" : "text-gold-300"}`}>
                {c.points}
                {c.max > 0 && <span className="text-smoke-400">/{c.max}</span>}
              </span>
              <ul className="space-y-0.5 text-xs leading-relaxed text-smoke-400">
                {c.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {/* Contradictions */}
      <section aria-labelledby="con-h">
        <h2 id="con-h" className="font-display text-3xl font-semibold text-paper">
          Every lie in the case
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {res.contradictions.map((c) => (
            <li key={c.id} className={`panel p-5 ${c.found ? "border-gold-700/60" : "opacity-80"}`}>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-wider uppercase">
                {c.found ? (
                  <span className="flex items-center gap-1 text-gold-400">
                    <CheckCircle2 className="size-3.5" /> You proved this
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-smoke-400">
                    <CircleDashed className="size-3.5" /> Missed
                  </span>
                )}
                {c.decisive && <span className="rounded-sm border border-blood-500 px-1.5 text-blood-400">Decisive</span>}
                <span className="text-smoke-400">{c.points} pts</span>
              </div>
              <p className="mt-3 text-sm text-smoke-200">
                <span className="text-paper">{c.suspect_name}</span>: “{c.claim}”
              </p>
              <p className="mt-1 text-xs text-smoke-400">vs {c.evidence.join(" / ")}</p>
              <p className="mt-3 text-sm leading-relaxed text-smoke-300">{c.explanation}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Timeline */}
      <section aria-labelledby="tl-h">
        <h2 id="tl-h" className="flex items-center gap-2 font-display text-3xl font-semibold text-paper">
          <Clock className="size-6 text-gold-500" /> The morning, minute by minute
        </h2>
        <p className="mt-2 text-sm text-smoke-400">Highlighted moments are ones your evidence could prove.</p>
        <ol className="relative mt-6 space-y-4 border-l border-ink-600 pl-6">
          {res.timeline.map((t, i) => (
            <li key={i} className="relative">
              <span
                className={`absolute top-1.5 -left-[29px] size-2.5 rounded-full ${
                  t.you_found ? "bg-gold-400" : "bg-ink-600"
                }`}
                aria-hidden="true"
              />
              <div className="flex gap-4">
                <span className={`font-mono text-sm tabular-nums ${t.you_found ? "text-gold-300" : "text-smoke-400"}`}>
                  {t.time}
                </span>
                <span className={`text-sm leading-relaxed ${t.you_found ? "text-paper" : "text-smoke-300"}`}>
                  {t.text}
                  {t.evidence_ids.length > 0 && (
                    <span className="ml-2 font-mono text-[10px] text-smoke-400">{t.evidence_ids.join(" ")}</span>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Innocents + your accusation */}
      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl font-semibold text-paper">Why the others are innocent</h2>
          <ul className="mt-4 space-y-4">
            {res.innocents.map((n) => {
              const s = session.suspects.find((x) => x.id === n.suspect_id);
              return (
                <li key={n.suspect_id} className="flex gap-3">
                  {s && <SuspectPortrait suspect={s} className="size-10 shrink-0 rounded-full" />}
                  <p className="text-sm leading-relaxed text-smoke-300">
                    <span className="text-paper">{n.name}.</span> {n.explanation}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-2xl font-semibold text-paper">Your accusation</h2>
          <div className="panel mt-4 p-5">
            <p className="flex items-center gap-2 text-sm text-paper">
              {res.correct ? (
                <CheckCircle2 className="size-4 text-gold-400" />
              ) : (
                <XCircle className="size-4 text-blood-400" />
              )}
              {res.accusation.suspect_name}
              <span className="text-xs text-smoke-400">· {res.accusation.mode === "voice" ? "dictated" : "typed"}</span>
            </p>
            <blockquote className="mt-3 border-l-2 border-gold-700 pl-4 text-sm leading-relaxed whitespace-pre-wrap text-smoke-200">
              {res.accusation.explanation}
            </blockquote>
            <p className="mt-4 text-xs text-smoke-400">
              Evidence cited: {res.accusation.evidence.length ? res.accusation.evidence.join(", ") : "none"}
            </p>
            {res.accusation.contradiction && (
              <p className="mt-1 text-xs text-smoke-400">Key contradiction: {res.accusation.contradiction}</p>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-ink-700 pt-8">
        <Link to="/dashboard" className="btn-primary">
          Back to Detective HQ
        </Link>
        <Link to={`/case/${res.case.id}/briefing`} className="btn-ghost">
          <RotateCcw className="size-4" /> Investigate again from scratch
        </Link>
      </div>
    </div>
  );
}
