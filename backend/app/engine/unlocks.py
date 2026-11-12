"""Evidence unlocking. The server decides what the player has found; the client only renders it."""

from ..schemas.case import CaseDefinition


def initial_evidence(case: CaseDefinition) -> list[str]:
    return [e.id for e in case.evidence if e.unlock.initial]


def resolve_unlocks(case: CaseDefinition, trigger: str, already: set[str]) -> list[str]:
    """Evidence ids newly unlocked by `trigger`, including cascades (evidence:<id> triggers).

    Returned in unlock order. Does not mutate `already`.
    """
    have = set(already)
    new: list[str] = []
    pending = [trigger]
    while pending:
        t = pending.pop(0)
        for e in case.evidence:
            if e.id in have or t not in e.unlock.triggers:
                continue
            have.add(e.id)
            new.append(e.id)
            pending.append(f"evidence:{e.id}")
    return new
