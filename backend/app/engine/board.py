"""Evidence board rules: checking a claim against evidence, and choosing the next hint.

The player pins a suspect's claim against a piece of evidence. The server decides whether that pair
is an authored contradiction. It never says how close a wrong guess was, and it never says whether
a found contradiction is "decisive" or how many points it is worth until the case is closed.

Costs are fixed here and shown to the player up front (the brief asks for transparent scoring):
  * Wrong links: the first FREE_WRONG_LINKS are free, then -1 point each, at most -WRONG_LINK_CAP.
    Retrying the same wrong pair costs nothing.
  * Hints: -HINT_COST points each, at most HINT_LIMIT hints.
"""

from ..schemas.case import CaseDefinition, Contradiction, Hint

FREE_WRONG_LINKS = 5
WRONG_LINK_CAP = 5
HINT_COST = 3
HINT_LIMIT = 5


def match_contradiction(case: CaseDefinition, claim_id: str, evidence_id: str) -> Contradiction | None:
    return next(
        (c for c in case.contradictions if c.claim_id == claim_id and evidence_id in c.evidence_ids),
        None,
    )


def wrong_link_penalty(wrong_attempts: int) -> int:
    return min(WRONG_LINK_CAP, max(0, wrong_attempts - FREE_WRONG_LINKS))


def hint_done(hint: Hint, contradictions: set[str], evidence: set[str], revealed: set[str]) -> bool:
    for cond in hint.done_when:
        kind, _, arg = cond.partition(":")
        if (
            (kind == "contradiction" and arg in contradictions)
            or (kind == "found" and arg in evidence)
            or (kind == "revealed" and arg in revealed)
        ):
            return True
    return False


def next_hint(case: CaseDefinition, contradictions: set[str], evidence: set[str], revealed: set[str]) -> Hint | None:
    return next((h for h in case.hints if not hint_done(h, contradictions, evidence, revealed)), None)
