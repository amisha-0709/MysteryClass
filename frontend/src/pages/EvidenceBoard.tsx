import { CheckCircle2, GripVertical, Lightbulb, Link2, Maximize2, Quote, X, XCircle } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, type BoardState, type Evidence, type FoundContradiction } from "../api/client";
import { KIND_ICON, EvidenceDialog } from "../components/EvidenceCard";
import { NotesPanel } from "../components/NotesPanel";
import { SuspectPortrait } from "../components/SuspectPortrait";
import { TimelineBuilder } from "../components/TimelineBuilder";
import { useSession } from "../context/SessionContext";
import { useToast } from "../context/ToastContext";

type Outcome =
  | { kind: "contradiction"; found: FoundContradiction; newEvidence: Evidence[] }
  | { kind: "no_contradiction" | "already_found" | "already_tried" | "error"; message: string };

const DRAG_TYPE = "application/x-mc-evidence";

const RESULT_MESSAGES = {
  no_contradiction: "These two can both be true. No contradiction here.",
  already_found: "You've already proven that contradiction. Nothing new, and no cost.",
  already_tried: "You've tested this pair before: no contradiction. Retrying is free.",
} as const;

export default function EvidenceBoard() {
  const { state, setState } = useSession();
  const notify = useToast();
  const board = state.board;
  const [claimId, setClaimId] = useState<string | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [testing, setTesting] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [open, setOpen] = useState<Evidence | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [hintNote, setHintNote] = useState<string | null>(null);

  const claims = useMemo(
    () => new Map(state.suspects.flatMap((s) => s.claims.map((c) => [c.id, { ...c, suspect: s }] as const))),
    [state.suspects],
  );
  const brokenBy = useMemo(() => {
    const m = new Map<string, FoundContradiction>();
    for (const f of board.found) if (!m.has(f.claim_id)) m.set(f.claim_id, f);
    return m;
  }, [board.found]);
  const tried = useMemo(() => new Set(board.tried.map(([c, e]) => `${c}|${e}`)), [board.tried]);
  const closed = state.progress.status !== "active";

  const { free_wrong_links: free, wrong_link_cap: cap, hint_cost, hint_limit } = board.rules;
  const penalty = Math.min(cap, Math.max(0, board.wrong_attempts - free));

  function applyBoard(next: BoardState, newEvidence: Evidence[] = []) {
    setState({
      ...state,
      board: next,
      evidence: [...state.evidence, ...newEvidence],
      progress: { ...state.progress, evidence_found: state.progress.evidence_found + newEvidence.length },
    });
  }

  async function test(cId = claimId, eId = evidenceId) {
    if (!cId || !eId || testing || closed) return;
    setTesting(true);
    setOutcome(null);
    try {
      const r = await api.testLink(state.id, cId, eId);
      applyBoard(r.board, r.new_evidence);
      if (window.matchMedia("(max-width: 1023px)").matches) {
        requestAnimationFrame(() =>
          document.getElementById("link-h")?.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
      }
      if (r.result === "contradiction" && r.contradiction) {
        setOutcome({ kind: "contradiction", found: r.contradiction, newEvidence: r.new_evidence });
        notify({ kind: "proven", title: "Contradiction proven", body: r.contradiction.explanation });
        for (const e of r.new_evidence) {
          notify({
            kind: "evidence",
            title: `New lead: ${e.title}`,
            body: e.summary,
            to: `/case/${state.case.id}/investigation`,
            action: "Open the evidence locker",
          });
        }
        setClaimId(null);
        setEvidenceId(null);
      } else if (r.result !== "contradiction") {
        setOutcome({ kind: r.result, message: RESULT_MESSAGES[r.result] });
      }
    } catch (e) {
      setOutcome({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't test that link." });
    } finally {
      setTesting(false);
    }
  }

  async function takeHint() {
    setHintBusy(true);
    setHintNote(null);
    try {
      const r = await api.hint(state.id);
      applyBoard(r.board);
      if (r.hint === null) setHintNote("You've used all your hints. Trust your reasoning.");
      else if (!r.charged) setHintNote("Same advice as before, so no extra cost. Make some progress first.");
    } catch (e) {
      setHintNote((e as Error).message);
    } finally {
      setHintBusy(false);
    }
  }

  function onDrop(e: DragEvent, cId: string) {
    e.preventDefault();
    setDropTarget(null);
    const eId = e.dataTransfer.getData(DRAG_TYPE);
    if (!eId) return;
    setClaimId(cId);
    setEvidenceId(eId);
    test(cId, eId);
  }

  const selClaim = claimId ? claims.get(claimId) : undefined;
  const selEvidence = state.evidence.find((e) => e.id === evidenceId);
  const pairTried = claimId && evidenceId ? tried.has(`${claimId}|${evidenceId}`) : false;

  return (
    <div className="animate-rise">
      <p className="eyebrow">Stage 5 · Evidence board</p>
      <h1 className="mt-3 font-display text-4xl font-semibold text-paper sm:text-5xl">Find what doesn't add up</h1>
      <p className="mt-3 max-w-3xl leading-relaxed text-smoke-300">
        <span className="sm:hidden">Tap a statement and a record that can't both be true, then test.</span>
        <span className="hidden sm:inline">
          Pick a statement and a piece of evidence that can't both be true, then test the link. You can also drag
          evidence onto a statement. Proven contradictions can open new leads.
        </span>
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px_minmax(0,1fr)]">
        {/* Statements */}
        <section aria-labelledby="claims-h" className="min-w-0">
          <h2 id="claims-h" className="eyebrow mb-3">
            Statements
          </h2>
          <div className="space-y-4">
            {state.suspects.map((s) => (
              <div key={s.id} className="panel p-3">
                <div className="mb-2 flex items-center gap-2">
                  <SuspectPortrait suspect={s} className="size-8 rounded-full" />
                  <span className="text-sm font-medium text-paper">{s.name}</span>
                </div>
                <ul className="space-y-2">
                  {s.claims.map((c) => {
                    const broken = brokenBy.get(c.id);
                    const selected = claimId === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setClaimId(selected ? null : c.id);
                            setOutcome(null);
                          }}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                              e.preventDefault();
                              setDropTarget(c.id);
                            }
                          }}
                          onDragLeave={() => setDropTarget((t) => (t === c.id ? null : t))}
                          onDrop={(e) => onDrop(e, c.id)}
                          aria-pressed={selected}
                          className={`relative flex w-full gap-2 rounded-sm border p-2.5 text-left text-sm transition ${
                            selected
                              ? "border-gold-500 bg-gold-500/10 text-paper"
                              : dropTarget === c.id
                                ? "border-gold-400 bg-gold-500/5 text-paper"
                                : broken
                                  ? "border-blood-700 bg-blood-700/10 text-smoke-200"
                                  : "border-ink-700 text-smoke-200 hover:border-ink-600"
                          }`}
                        >
                          <Quote className="mt-0.5 size-3.5 shrink-0 text-gold-700" />
                          <span className="min-w-0 flex-1">
                            {c.text}
                            {broken && (
                              <span className="mt-1.5 flex items-center gap-1 font-mono text-[10px] tracking-wider text-blood-400 uppercase">
                                <XCircle className="size-3" /> Contradicted by {broken.evidence_id}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* The link */}
        <section aria-labelledby="link-h" className="lg:order-none">
          <div className="space-y-4 lg:sticky lg:top-24">
            <div className="panel border-gold-700/60 p-4">
              <h2 id="link-h" className="eyebrow flex items-center gap-2">
                <Link2 className="size-3.5" /> Test a link
              </h2>
              <Slot
                label="Statement"
                value={selClaim ? `${selClaim.suspect.name.split(" ")[0]}: “${selClaim.text}”` : null}
                placeholder="Pick a statement"
                onClear={() => setClaimId(null)}
              />
              <div className="my-1 text-center font-mono text-[10px] tracking-[0.3em] text-smoke-400">VS</div>
              <Slot
                label="Evidence"
                value={selEvidence ? `${selEvidence.id} · ${selEvidence.title}` : null}
                placeholder="Pick evidence"
                onClear={() => setEvidenceId(null)}
              />
              <button
                type="button"
                onClick={() => test()}
                disabled={!claimId || !evidenceId || testing || closed}
                className="btn-primary mt-4 w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testing ? "Checking…" : pairTried ? "Tested before (free)" : "Test the link"}
              </button>

              {outcome && <OutcomeView outcome={outcome} />}

              <p className="mt-4 border-t border-ink-700 pt-3 text-xs leading-relaxed text-smoke-400">
                Wrong links: <span className="text-paper">{board.wrong_attempts}</span>. The first {free} are free, then
                −1 point each (at most −{cap}).
                {penalty > 0 && <span className="text-blood-400"> Current cost: −{penalty}.</span>}
              </p>
            </div>

            <div className="panel p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="eyebrow flex items-center gap-2">
                  <Lightbulb className="size-3.5" /> Hints
                </h2>
                <span className="font-mono text-[10px] text-smoke-400">
                  {board.hints.length}/{hint_limit} used
                </span>
              </div>
              {board.hints.length > 0 && (
                <ol className="mt-3 space-y-2">
                  {board.hints.map((h, i) => (
                    <li key={i} className="rounded-sm border border-ink-700 bg-ink-950/50 p-2.5 text-sm text-smoke-200">
                      {h}
                    </li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                onClick={takeHint}
                disabled={hintBusy || closed || board.hints.length >= hint_limit}
                className="btn-ghost mt-3 w-full justify-center px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {hintBusy ? "Thinking…" : `Get a hint (−${hint_cost} points)`}
              </button>
              {hintNote && <p className="mt-2 text-xs text-smoke-400">{hintNote}</p>}
            </div>
          </div>
        </section>

        {/* Evidence */}
        <section aria-labelledby="ev-h" className="min-w-0">
          <h2 id="ev-h" className="eyebrow mb-3">
            Evidence · {state.evidence.length}/{state.progress.evidence_total}
          </h2>
          <ul className="space-y-2">
            {state.evidence.map((e) => {
              const Icon = KIND_ICON[e.kind];
              const selected = evidenceId === e.id;
              return (
                <li
                  key={e.id}
                  draggable={!closed}
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData(DRAG_TYPE, e.id);
                    ev.dataTransfer.effectAllowed = "link";
                  }}
                  className={`group flex items-stretch rounded-sm border transition ${
                    selected ? "border-gold-500 bg-gold-500/10" : "border-ink-700 bg-ink-900/60 hover:border-ink-600"
                  }`}
                >
                  <span className="hidden cursor-grab items-center pl-1.5 text-ink-600 group-hover:text-smoke-400 sm:flex" aria-hidden="true">
                    <GripVertical className="size-4" />
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEvidenceId(selected ? null : e.id);
                      setOutcome(null);
                    }}
                    aria-pressed={selected}
                    className="flex min-w-0 flex-1 items-start gap-3 p-3 text-left"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-gold-500" />
                    <span className="min-w-0">
                      <span className="block text-sm text-paper">
                        <span className="font-mono text-xs text-gold-400">{e.id}</span> {e.title}
                      </span>
                      <span className="line-clamp-2 text-xs text-smoke-400">{e.summary}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(e)}
                    aria-label={`Read ${e.title}`}
                    title="Read the full record"
                    className="px-3 text-smoke-400 transition hover:text-paper"
                  >
                    <Maximize2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {board.found.length > 0 && (
        <section aria-labelledby="found-h" className="mt-12">
          <h2 id="found-h" className="font-display text-3xl font-semibold text-paper">
            Proven contradictions
          </h2>
          <ul className="mt-5 grid gap-4 md:grid-cols-2">
            {board.found.map((f) => {
              const c = claims.get(f.claim_id);
              const ev = state.evidence.find((e) => e.id === f.evidence_id);
              return (
                <li key={f.id} className="panel border-blood-700/60 p-5">
                  <p className="text-sm text-smoke-300">
                    <span className="text-paper">{c?.suspect.name}</span>: “{c?.text}”
                  </p>
                  <p className="mt-1 font-mono text-[11px] tracking-wider text-blood-400 uppercase">
                    vs {f.evidence_id} {ev?.title}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-smoke-200">{f.explanation}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <TimelineBuilder />
        <NotesPanel />
      </div>

      <EvidenceDialog item={open} onClose={() => setOpen(null)} />

      {/* Phones: the link panel sits between two long lists, so keep the current pair within reach.
          Portalled to <body>: the page's entrance animation leaves a transform that would trap position:fixed. */}
      {(claimId || evidenceId) &&
        !closed &&
        createPortal(
        <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-30 border-t border-gold-700/60 bg-ink-900/95 p-3 backdrop-blur md:bottom-0 lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <p className="min-w-0 flex-1 text-xs leading-snug text-smoke-200">
              <span className="block truncate">
                {selClaim ? `“${selClaim.text}”` : <span className="text-smoke-400">Pick a statement</span>}
              </span>
              <span className="block truncate text-gold-400">
                {selEvidence ? `vs ${selEvidence.id} ${selEvidence.title}` : <span className="text-smoke-400">Pick evidence</span>}
              </span>
            </p>
            <button
              type="button"
              onClick={() => test()}
              disabled={!claimId || !evidenceId || testing}
              className="btn-primary shrink-0 px-4 py-2 text-xs disabled:opacity-40"
            >
              {testing ? "…" : "Test"}
            </button>
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}

function Slot({
  label,
  value,
  placeholder,
  onClear,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onClear: () => void;
}) {
  return (
    <div
      className={`mt-3 flex min-h-12 items-center gap-2 rounded-sm border px-3 py-2 text-sm ${
        value ? "border-ink-600 bg-ink-950/60 text-paper" : "border-dashed border-ink-600 text-smoke-400"
      }`}
    >
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 flex-1">{value ?? placeholder}</span>
      {value && (
        <button type="button" onClick={onClear} aria-label={`Clear ${label}`} className="text-smoke-400 hover:text-paper">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "contradiction") {
    return (
      <div role="status" className="mt-4 rounded-sm border border-gold-700 bg-gold-500/10 p-3 text-sm">
        <p className="flex items-center gap-2 font-semibold text-gold-300">
          <CheckCircle2 className="size-4" /> Contradiction proven
        </p>
        <p className="mt-2 leading-relaxed text-smoke-200">{outcome.found.explanation}</p>
        {outcome.newEvidence.map((e) => (
          <p key={e.id} className="mt-2 text-xs text-paper">
            New lead: <span className="font-mono text-gold-400">{e.id}</span> {e.title}
          </p>
        ))}
      </div>
    );
  }
  const bad = outcome.kind === "no_contradiction" || outcome.kind === "error";
  return (
    <p
      role="status"
      className={`mt-4 flex items-start gap-2 rounded-sm border p-3 text-sm ${
        bad ? "border-blood-700/70 text-blood-400" : "border-ink-600 text-smoke-300"
      }`}
    >
      <XCircle className="mt-0.5 size-4 shrink-0" />
      {outcome.message}
    </p>
  );
}
