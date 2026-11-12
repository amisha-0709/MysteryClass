"""Achievements: earned once per player, checked when a case is closed. Labels are public."""

from dataclasses import dataclass

from ..schemas.case import CaseDefinition
from .scoring import Investigation, ScoreReport


@dataclass(frozen=True)
class AchievementDef:
    code: str
    title: str
    description: str


ACHIEVEMENTS: list[AchievementDef] = [
    AchievementDef("case_closed", "Case Closed", "Make your first accusation."),
    AchievementDef("unmasked", "Unmasked", "Name the right culprit."),
    AchievementDef("airtight", "Airtight", "Prove every contradiction that implicates the culprit."),
    AchievementDef("full_file", "Full File", "Find every piece of evidence in a case."),
    AchievementDef("unassisted", "Unassisted", "Solve a case without a single hint."),
    AchievementDef("clean_board", "Clean Board", "Solve a case without a wrong link on the board."),
    AchievementDef("master", "Master Detective", "Score 90 or more on a case."),
]


def earned(case: CaseDefinition, inv: Investigation, report: ScoreReport) -> set[str]:
    out = {"case_closed"}
    if report.solved:
        out.add("unmasked")
        if inv.hints_used == 0:
            out.add("unassisted")
        if inv.wrong_links == 0:
            out.add("clean_board")
    if set(case.solution.decisive_contradictions) <= inv.proven:
        out.add("airtight")
    if {e.id for e in case.evidence} <= inv.evidence_found:
        out.add("full_file")
    if report.total >= 90:
        out.add("master")
    return out
