"""Transparent 100-point scoring. Pure: the caller gathers what happened and persists the report.

| Component        | Max | Rule                                                                         |
|------------------|-----|------------------------------------------------------------------------------|
| Culprit          | 25  | Correct with ≥1 decisive evidence selected = 25; correct but unsupported = 10 |
| Evidence         | 20  | +5 per decisive item covered; red herrings −2 each; floor 0                   |
| Contradictions   | 25  | Points of each proven contradiction, minus the wrong-link penalty; floor 0    |
| Explanation      | 15  | +3 per rubric idea mentioned (max 15); halved if the culprit is wrong         |
| Questioning      | 15  | 15 × (admissions drawn out ÷ admissions possible), rounded                     |
| Hints            | −15 | −3 per hint                                                                    |

Evidence that proves the same decisive contradiction counts as the same item (E7 covers E8 in Case 001).
Supporting evidence (solution.supporting_evidence) is neither rewarded nor penalised.
"""

from dataclasses import asdict, dataclass, field

from ..schemas.case import CaseDefinition
from . import board
from .interrogation import _has, normalize

CULPRIT_MAX, CULPRIT_GUESS = 25, 10
EVIDENCE_EACH, EVIDENCE_MAX, RED_HERRING_COST = 5, 20, 2
CONTRADICTIONS_MAX = 25
CONCEPT_EACH, EXPLANATION_MAX = 3, 15
QUESTIONING_MAX = 15


@dataclass
class Component:
    id: str
    label: str
    points: int
    max: int
    notes: list[str] = field(default_factory=list)


@dataclass
class Category:
    id: str
    label: str
    percent: int
    description: str


@dataclass
class ScoreReport:
    total: int
    solved: bool
    components: list[Component]
    categories: list[Category]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Investigation:
    """Everything the player did, gathered by the caller."""

    accused: str
    explanation: str
    selected_evidence: list[str]
    proven: set[str]  # contradiction ids
    wrong_links: int
    hints_used: int
    revealed: set[str]  # "<suspect>.<topic>"
    evidence_found: set[str]


def _round(x: float) -> int:
    """Half-up rounding (Python's round() sends 13.5 to 14 but 12.5 to 12)."""
    return int(x + 0.5)


def revealable_topics(case: CaseDefinition) -> set[str]:
    return {f"{s.id}.{t}" for s in case.suspects for tp in s.topics for r in tp.replies for t in r.reveals}


def evidence_groups(case: CaseDefinition) -> dict[str, set[str]]:
    """decisive item → every evidence id that proves the same thing (itself + co-listed in a decisive contradiction)."""
    groups = {d: {d} for d in case.solution.decisive_evidence}
    for c in case.contradictions:
        if c.id in case.solution.decisive_contradictions:
            for d in groups:
                if d in c.evidence_ids:
                    groups[d] |= set(c.evidence_ids)
    return groups


def concepts_covered(case: CaseDefinition, text: str) -> list[str]:
    t = normalize(text)
    return [r.id for r in case.solution.rubric if any(_has(t, k) for k in r.keywords)]


def score(case: CaseDefinition, inv: Investigation) -> ScoreReport:
    sol = case.solution
    names = {s.id: s.name for s in case.suspects}
    ev_title = {e.id: e.title for e in case.evidence}
    correct = inv.accused == sol.culprit_id

    # ── evidence selection ──
    groups = evidence_groups(case)
    selected = list(dict.fromkeys(inv.selected_evidence))
    covered = [d for d, g in groups.items() if g & set(selected)]
    relevant = set().union(*groups.values()) | set(sol.supporting_evidence)
    herrings = [e for e in selected if e not in relevant]
    ev_points = max(0, min(EVIDENCE_MAX, EVIDENCE_EACH * len(covered) - RED_HERRING_COST * len(herrings)))
    ev_notes = [f"+{EVIDENCE_EACH} {ev_title[d]}" for d in covered]
    ev_notes += [f"−{RED_HERRING_COST} {ev_title[e]} (doesn't point to the culprit)" for e in herrings]
    missed = [ev_title[d] for d in groups if d not in covered]
    if missed:
        ev_notes.append("Not cited: " + ", ".join(missed))

    # ── culprit ──
    if not correct:
        culprit_pts, culprit_note = 0, f"You accused {names.get(inv.accused, inv.accused)}. The culprit was {names[sol.culprit_id]}."
    elif covered:
        culprit_pts, culprit_note = CULPRIT_MAX, f"Correct: {names[sol.culprit_id]}, backed by decisive evidence."
    else:
        culprit_pts, culprit_note = CULPRIT_GUESS, "Correct, but none of the evidence you cited proves it, so it scores as a guess."

    # ── contradictions ──
    raw = sum(c.points for c in case.contradictions if c.id in inv.proven)
    penalty = board.wrong_link_penalty(inv.wrong_links)
    con_points = max(0, min(CONTRADICTIONS_MAX, raw - penalty))
    con_notes = [f"+{c.points} {c.id}" + ("" if c.points else " (a real lie, but not about the theft)") for c in case.contradictions if c.id in inv.proven]
    if penalty:
        con_notes.append(f"−{penalty} for {inv.wrong_links} wrong links ({board.FREE_WRONG_LINKS} free)")
    missed_c = [c.id for c in case.contradictions if c.points and c.id not in inv.proven]
    if missed_c:
        con_notes.append("Missed: " + ", ".join(missed_c))

    # ── explanation ──
    concepts = concepts_covered(case, inv.explanation)
    labels = {r.id: r.label for r in sol.rubric}
    exp_raw = min(EXPLANATION_MAX, CONCEPT_EACH * len(concepts))
    exp_points = exp_raw if correct else exp_raw // 2
    exp_notes = [f"✓ {labels[c]}" for c in concepts] + [f"✗ {labels[r.id]}" for r in sol.rubric if r.id not in concepts]
    if not correct and exp_raw:
        exp_notes.append("Halved: the explanation describes the wrong person.")

    # ── questioning ──
    possible = revealable_topics(case)
    drawn = inv.revealed & possible
    q_points = _round(QUESTIONING_MAX * len(drawn) / len(possible)) if possible else 0
    q_notes = [f"{len(drawn)} of {len(possible)} admissions drawn out of the suspects"]

    # ── hints ──
    hint_pen = min(board.HINT_COST * board.HINT_LIMIT, board.HINT_COST * inv.hints_used)

    components = [
        Component("culprit", "Culprit", culprit_pts, CULPRIT_MAX, [culprit_note]),
        Component("evidence", "Evidence cited", ev_points, EVIDENCE_MAX, ev_notes),
        Component("contradictions", "Contradictions proven", con_points, CONTRADICTIONS_MAX, con_notes),
        Component("explanation", "Explanation", exp_points, EXPLANATION_MAX, exp_notes),
        Component("questioning", "Questioning", q_points, QUESTIONING_MAX, q_notes),
        Component("hints", "Hints", -hint_pen, 0, [f"{inv.hints_used} hint{'s' if inv.hints_used != 1 else ''} × −{board.HINT_COST}"]),
    ]
    total = max(0, min(100, sum(c.points for c in components)))

    found_ratio = len(inv.evidence_found) / len(case.evidence) if case.evidence else 0
    pct = lambda n, d: _round(100 * n / d) if d else 0  # noqa: E731
    categories = [
        Category("listening", "Listening", pct(q_points, QUESTIONING_MAX),
                 "How much the suspects let slip under your questioning."),
        Category("critical_thinking", "Critical thinking", pct(culprit_pts + con_points, CULPRIT_MAX + CONTRADICTIONS_MAX),
                 "Naming the right person and proving where the stories break."),
        Category("evidence_analysis", "Evidence analysis",
                 _round(70 * ev_points / EVIDENCE_MAX + 30 * found_ratio),
                 "Finding the records and citing the ones that matter."),
        Category("communication", "Communication", pct(exp_points, EXPLANATION_MAX),
                 "How completely your explanation described what happened."),
    ]
    return ScoreReport(total=total, solved=correct, components=components, categories=categories)


def xp_for(report: ScoreReport) -> int:
    return report.total * 2 if report.solved else report.total
