import { ArrowRight, Check, ChevronDown, Circle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { caseLeads, progressPercent } from "../lib/caseProgress";

/** Small circular meter for the header: how much of the investigation checklist is done. */
export function ProgressRing({ percent, size = 30 }: { percent: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-gold-500)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - percent / 100)}
        className="transition-[stroke-dashoffset] duration-700"
      />
    </svg>
  );
}

/** Header chip: ring + percentage, links to the checklist. */
export function ProgressChip() {
  const { state } = useSession();
  const pct = progressPercent(caseLeads(state));
  return (
    <Link
      to={`/case/${state.case.id}/investigation#leads`}
      className="flex items-center gap-2 rounded-full border border-ink-700 py-0.5 pr-3 pl-0.5 text-smoke-300 transition hover:border-gold-700 hover:text-paper"
      aria-label={`Investigation ${pct}% complete. Open your leads.`}
    >
      <ProgressRing percent={pct} />
      <span className="font-mono text-[11px] tabular-nums">{pct}%</span>
    </Link>
  );
}

/** "What should I do next?" Generic investigative steps; never points at the answer. */
export function LeadsCard({ compact = false }: { compact?: boolean }) {
  const { state } = useSession();
  const leads = caseLeads(state);
  const next = leads.find((l) => !l.done);
  const pct = progressPercent(leads);
  const base = `/case/${state.case.id}`;
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.matchMedia("(min-width: 1280px)").matches;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (hash !== "#leads") return;
    setExpanded(true);
    ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [hash]);
  const doneCount = leads.filter((l) => l.done).length;

  return (
    <section ref={ref} id="leads" aria-labelledby="leads-h" className="panel scroll-mt-24 p-5">
      <div className="flex items-center gap-3">
        <ProgressRing percent={pct} size={40} />
        <div>
          <h2 id="leads-h" className="eyebrow">
            Your leads
          </h2>
          <p className="text-sm text-paper">{pct}% of the investigation done</p>
        </div>
      </div>

      {next && (
        <Link
          to={`${base}/${next.to}`}
          className="group mt-4 flex items-center gap-3 rounded-sm border border-gold-700/70 bg-gold-500/5 p-3 transition hover:border-gold-500"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[10px] tracking-[0.2em] text-gold-400 uppercase">Next</span>
            <span className="block text-sm text-paper">{next.label}</span>
            <span className="block text-xs text-smoke-400">{next.detail}</span>
          </span>
          <ArrowRight className="size-4 text-gold-400 transition group-hover:translate-x-0.5" />
        </Link>
      )}

      {!compact && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="mt-2 flex min-h-8 w-full items-center gap-2 py-1.5 text-xs text-smoke-400 transition hover:text-paper"
        >
          All leads · {doneCount} of {leads.length} done
          <ChevronDown className={`ml-auto size-4 transition ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}

      {!compact && expanded && (
        <ol className="mt-2 space-y-1">
          {leads.map((l) => (
            <li key={l.id}>
              <Link
                to={`${base}/${l.to}`}
                className="flex items-start gap-2.5 rounded-sm px-1.5 py-1.5 text-sm transition hover:bg-ink-800"
              >
                {l.done ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-gold-400" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-ink-600" aria-label="To do" />
                )}
                <span className="min-w-0">
                  <span className={`block ${l.done ? "text-smoke-400 line-through decoration-ink-600" : "text-smoke-200"}`}>
                    {l.label}
                  </span>
                  {!l.done && <span className="block text-xs text-smoke-400">{l.detail}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
