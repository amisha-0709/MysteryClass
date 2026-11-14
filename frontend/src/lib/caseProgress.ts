import type { SessionState } from "../api/client";

export const INITIAL_SOURCE = "Initial case file";

export interface Lead {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  /** Stage path inside the case, e.g. "interrogation". */
  to: string;
}

/**
 * The player's to-do list. Only general investigative habits, computed from public state, so it never
 * hints at who did it or which records matter (that's what the paid hints are for).
 */
export function caseLeads(s: SessionState): Lead[] {
  const counts = Object.values(s.interrogation ?? {});
  const questioned = counts.filter((c) => c.asked > 0).length;
  const slips = counts.reduce((n, c) => n + c.slips, 0);
  const newFinds = s.evidence.filter((e) => e.source !== INITIAL_SOURCE).length;
  const proven = s.board.found.length;
  const { evidence_found, evidence_total } = s.progress;
  const n = s.suspects.length;

  return [
    { id: "briefing", label: "Read the briefing", detail: "Know the scene before you start.", done: s.progress.briefing_done, to: "briefing" },
    {
      id: "question",
      label: "Question every suspect",
      detail: `${questioned} of ${n} questioned`,
      done: questioned >= n,
      to: "interrogation",
    },
    {
      id: "slip",
      label: "Catch someone out",
      detail: slips ? `${slips} admission${slips > 1 ? "s" : ""} so far` : "Show a suspect a record that contradicts them.",
      done: slips > 0,
      to: "interrogation",
    },
    {
      id: "uncover",
      label: "Turn up new evidence",
      detail: newFinds ? `${newFinds} new record${newFinds > 1 ? "s" : ""} found` : "Admissions and proven lies open new leads.",
      done: newFinds > 0,
      to: "interrogation",
    },
    {
      id: "prove",
      label: "Prove a lie on the board",
      detail: proven ? `${proven} contradiction${proven > 1 ? "s" : ""} proven` : "Pin a statement against the record it breaks.",
      done: proven > 0,
      to: "board",
    },
    {
      id: "file",
      label: "Complete the evidence file",
      detail: `${evidence_found} of ${evidence_total} records`,
      done: evidence_found >= evidence_total,
      to: "investigation",
    },
    {
      id: "accuse",
      label: "Make your accusation",
      detail: "When you can say who, how, and what proves it.",
      done: s.progress.status === "closed",
      to: "accusation",
    },
  ];
}

export function progressPercent(leads: Lead[]): number {
  return Math.round((100 * leads.filter((l) => l.done).length) / leads.length);
}
