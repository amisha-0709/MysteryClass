import { describe, expect, it } from "vitest";
import type { Evidence, SessionState } from "../api/client";
import { caseLeads, INITIAL_SOURCE, progressPercent } from "./caseProgress";

const ev = (id: string, source = INITIAL_SOURCE) => ({ id, source }) as Evidence;

function state(over: Partial<SessionState> = {}): SessionState {
  return {
    suspects: [{ id: "a" }, { id: "b" }],
    evidence: [ev("E1"), ev("E2")],
    progress: { briefing_done: true, status: "active", evidence_found: 2, evidence_total: 4 },
    board: { found: [] },
    interrogation: { a: { asked: 0, slips: 0 }, b: { asked: 0, slips: 0 } },
    ...over,
  } as unknown as SessionState;
}

const done = (s: SessionState) => caseLeads(s).filter((l) => l.done).map((l) => l.id);

describe("caseLeads", () => {
  it("starts with only the briefing done", () => {
    expect(done(state())).toEqual(["briefing"]);
    expect(caseLeads(state()).find((l) => !l.done)?.id).toBe("question");
  });

  it("tracks questioning, slips, new finds and proven lies from public state", () => {
    const s = state({
      interrogation: { a: { asked: 3, slips: 1 }, b: { asked: 1, slips: 0 } },
      evidence: [ev("E1"), ev("E2"), ev("E5", "Revealed in interrogation")],
      board: { found: [{ id: "C2" }] } as unknown as SessionState["board"],
    });
    expect(done(s)).toEqual(["briefing", "question", "slip", "uncover", "prove"]);
  });

  it("only counts every suspect as questioned when all of them are", () => {
    const s = state({ interrogation: { a: { asked: 2, slips: 0 }, b: { asked: 0, slips: 0 } } });
    const q = caseLeads(s).find((l) => l.id === "question")!;
    expect(q.done).toBe(false);
    expect(q.detail).toBe("1 of 2 questioned");
  });

  it("finishes at 100% when the case is closed with a full file", () => {
    const s = state({
      interrogation: { a: { asked: 1, slips: 1 }, b: { asked: 1, slips: 0 } },
      evidence: [ev("E1"), ev("E9", "Exposed by a contradiction")],
      board: { found: [{ id: "C1" }] } as unknown as SessionState["board"],
      progress: { briefing_done: true, status: "closed", evidence_found: 4, evidence_total: 4 },
    });
    expect(progressPercent(caseLeads(s))).toBe(100);
  });
});
