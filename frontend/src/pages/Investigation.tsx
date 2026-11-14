import { useEffect, useState } from "react";
import type { Evidence } from "../api/client";
import { LeadsCard } from "../components/CaseProgress";
import { EvidenceCard, EvidenceDialog } from "../components/EvidenceCard";
import { NotesPanel } from "../components/NotesPanel";
import { SuspectCard } from "../components/SuspectCard";
import { useSession } from "../context/SessionContext";
import { useSeenEvidence } from "../hooks/useSeenEvidence";

export default function Investigation() {
  const { state } = useSession();
  const [open, setOpen] = useState<Evidence | null>(null);
  const { evidence_found, evidence_total } = state.progress;
  const { unseen, markSeen } = useSeenEvidence(state.id, state.evidence);
  // Snapshot what was new when the page opened, so the tags stay visible for this visit,
  // while the tab badge clears straight away.
  const [freshOnArrival] = useState(() => new Set(unseen));
  useEffect(() => {
    if (unseen.length) markSeen(unseen);
  }, [unseen, markSeen]);

  return (
    <div className="animate-rise">
      <div className="grid gap-6 xl:grid-cols-[1fr_320px] xl:items-start">
        <div>
          <p className="eyebrow">Stage 2–3 · Listen and investigate</p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-paper sm:text-5xl">Investigation Room</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-smoke-300">
            <span className="sm:hidden">Listen closely. Check every claim against the records.</span>
            <span className="hidden sm:inline">
              Read every statement closely and check each claim against the records. Some of these people are
              lying. Not all of them about the same thing.
            </span>
          </p>
        </div>
        <LeadsCard />
      </div>

      <div className="mt-10 grid gap-8 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-14">
          <section aria-labelledby="statements-h">
            <h2 id="statements-h" className="font-display text-3xl font-semibold text-paper">
              Statements
            </h2>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {state.suspects.map((s) => (
                <SuspectCard key={s.id} suspect={s} sessionId={state.id} />
              ))}
            </div>
          </section>

          <section aria-labelledby="evidence-h">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 id="evidence-h" className="font-display text-3xl font-semibold text-paper">
                Evidence locker
              </h2>
              <div className="w-48">
                <p className="text-right font-mono text-[11px] tracking-[0.15em] text-smoke-400 uppercase">
                  {evidence_found} of {evidence_total} found
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full bg-gold-500 transition-all"
                    style={{ width: `${(evidence_found / evidence_total) * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-smoke-400">
              More evidence turns up when you question suspects and expose contradictions.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {state.evidence.map((e) => (
                <EvidenceCard key={e.id} item={e} isNew={freshOnArrival.has(e.id)} onOpen={() => setOpen(e)} />
              ))}
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <NotesPanel />
        </aside>
      </div>

      <EvidenceDialog item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
