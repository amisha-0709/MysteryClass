import { ArrowRight, Clock, MapPin, Signal, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { CaseSummary } from "../api/client";
import type { ApiState } from "../hooks/useApi";

export function FeaturedCase({ state }: { state: ApiState<CaseSummary[]> }) {
  if (state.status === "loading") {
    return <div className="panel h-72 animate-pulse" aria-label="Loading case file" />;
  }

  if (state.status === "error") {
    return (
      <div className="panel border-blood-700/60 p-8">
        <p className="eyebrow text-blood-400">Case files unavailable</p>
        <p className="mt-3 text-sm text-smoke-300">{state.message}</p>
      </div>
    );
  }

  const featured = state.data[0];
  if (!featured) {
    return (
      <div className="panel p-8 text-sm text-smoke-300">No cases have been filed yet.</div>
    );
  }

  return (
    <article className="group panel relative overflow-hidden transition hover:border-gold-700">
      {/* folder tab */}
      <div className="absolute top-0 left-8 h-1 w-24 bg-gold-500/80" aria-hidden="true" />

      <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="eyebrow">Case {featured.number}</span>
            <span className="stamp">Open</span>
          </div>

          <h3 className="mt-5 font-display text-3xl leading-tight font-semibold text-paper sm:text-4xl">
            {featured.title}
          </h3>
          <p className="mt-4 max-w-xl leading-relaxed text-smoke-300">{featured.teaser}</p>

          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-4">
            <Meta icon={<MapPin className="size-4" />} label="Location" value="Raman Block" />
            <Meta icon={<Clock className="size-4" />} label="Reported" value={featured.incident_time} />
            <Meta icon={<Users className="size-4" />} label="Suspects" value={String(featured.suspect_count)} />
            <Meta icon={<Signal className="size-4" />} label="Difficulty" value={featured.difficulty} />
          </dl>
        </div>

        <div className="flex items-end md:items-center">
          <Link to={`/case/${featured.id}/briefing`} className="btn-primary">
            Open case file
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-smoke-400 uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-smoke-200">{value}</dd>
    </div>
  );
}
