import { ArrowRight, CalendarDays, Clock, Crosshair, MapPin } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { AudioPlayer } from "../components/AudioPlayer";
import { SuspectPortrait } from "../components/SuspectPortrait";
import { useSession } from "../context/SessionContext";

export default function Briefing() {
  const { state, setState } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { briefing: b, case: c } = state;

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      if (!state.progress.briefing_done) setState(await api.completeBriefing(state.id));
      navigate(`/case/${c.id}/investigation`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise">
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="eyebrow">Case {c.number} · Briefing</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight font-semibold text-paper sm:text-6xl">
            {c.title}
          </h1>
        </div>
        <span className="stamp mt-2">Confidential</span>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Incident report */}
        <section className="panel p-6 sm:p-8">
          <h2 className="eyebrow">Incident report</h2>
          <p className="mt-4 text-lg leading-relaxed text-smoke-200">{b.incident}</p>

          <h3 className="eyebrow mt-10">Situation</h3>
          <ul className="mt-4 space-y-3">
            {b.situation.map((line) => (
              <li key={line} className="flex gap-3 text-sm leading-relaxed text-smoke-300">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-gold-500" />
                {line}
              </li>
            ))}
          </ul>

          <div className="mt-10 border-l-2 border-gold-700 pl-5">
            <h3 className="eyebrow">Narrator</h3>
            <AudioPlayer src={api.clipUrl(state.id, "narration")} label="the case narration" className="mt-4" />
            <blockquote className="mt-3 font-display text-xl leading-relaxed text-smoke-200 italic">
              {b.narration}
            </blockquote>
          </div>
        </section>

        {/* Facts + objective */}
        <aside className="flex flex-col gap-6">
          <dl className="panel divide-y divide-ink-700">
            <Fact icon={MapPin} label="Location" value={b.location} />
            <Fact icon={CalendarDays} label="Date" value={b.date} />
            <Fact icon={Clock} label="Time of incident" value={b.time_of_incident} />
          </dl>
          <div className="panel border-gold-700/70 p-6">
            <p className="eyebrow flex items-center gap-2">
              <Crosshair className="size-3.5" /> Mission objective
            </p>
            <p className="mt-3 leading-relaxed text-paper">{b.objective}</p>
          </div>
        </aside>
      </div>

      {/* Persons of interest */}
      <section className="mt-14">
        <h2 className="font-display text-3xl font-semibold text-paper">Persons of interest</h2>
        <ul className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {state.suspects.map((s) => (
            <li key={s.id} className="panel overflow-hidden">
              <SuspectPortrait suspect={s} className="aspect-[4/5] w-full" />
              <div className="p-4">
                <p className="font-display text-xl leading-tight text-paper">{s.name}</p>
                <p className="mt-1 text-xs text-smoke-400">{s.role}</p>
                <p className="mt-3 hidden text-sm text-smoke-300 sm:block">{s.personality}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-14 flex flex-wrap items-center gap-4 border-t border-ink-800 pt-8">
        <button onClick={begin} disabled={busy} className="btn-primary disabled:opacity-60">
          {state.progress.briefing_done ? "Continue the investigation" : "Begin the investigation"}
          <ArrowRight className="size-4" />
        </button>
        <p className="text-sm text-smoke-400">
          You'll hear each suspect's statement and review the evidence collected so far.
        </p>
        {error && <p className="w-full text-sm text-blood-400">{error}</p>}
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="p-5">
      <dt className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-smoke-400 uppercase">
        <Icon className="size-3.5 text-gold-500" />
        {label}
      </dt>
      <dd className="mt-2 text-sm leading-relaxed text-smoke-200">{value}</dd>
    </div>
  );
}
