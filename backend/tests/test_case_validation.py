import pytest

from app.engine.unlocks import initial_evidence, resolve_unlocks
from app.engine.validation import reachable_evidence, validate_case


def test_case_001_is_valid(case001):
    assert validate_case(case001) == []


def test_case_001_meets_brief_minimums(case001):
    assert len(case001.suspects) == 4
    assert len(case001.evidence) >= 6
    assert len(case001.contradictions) >= 3
    assert reachable_evidence(case001) == {e.id for e in case001.evidence}


def test_culprit_is_exposed_by_their_own_claims(case001):
    culprit = case001.suspect(case001.solution.culprit_id)
    culprit_claims = {c.id for c in culprit.claims}
    decisive = [c for c in case001.contradictions if c.id in case001.solution.decisive_contradictions]
    assert sum(c.claim_id in culprit_claims for c in decisive) >= 2


@pytest.mark.parametrize(
    "mutate, expected",
    [
        (lambda c: setattr(c.solution, "culprit_id", "nobody"), "unknown culprit"),
        (lambda c: setattr(c.contradictions[0], "claim_id", "ghost"), "unknown claim"),
        (lambda c: c.evidence[-1].unlock.triggers.__setitem__(0, "reveal:kabir.nope"), "unknown suspect topic"),
        (lambda c: c.evidence[-1].unlock.triggers.clear(), "unreachable"),
        (lambda c: setattr(c.timeline[3], "time", "07:00"), "out of order"),
        (lambda c: c.evidence.__setitem__(slice(3, None), []), "at least 6 evidence"),
    ],
)
def test_validator_catches_broken_cases(case001, mutate, expected):
    broken = case001.model_copy(deep=True)
    mutate(broken)
    errors = validate_case(broken)
    assert any(expected in e for e in errors), errors


def test_unlock_cascade_riya_contradiction_reveals_book_and_record(case001):
    have = set(initial_evidence(case001))
    assert resolve_unlocks(case001, "contradiction:C1", have) == ["E7", "E8"]


def test_unlock_is_idempotent(case001):
    have = set(initial_evidence(case001)) | {"E7", "E8"}
    assert resolve_unlocks(case001, "contradiction:C1", have) == []


def test_unknown_trigger_unlocks_nothing(case001):
    assert resolve_unlocks(case001, "reveal:kabir.confession", set(initial_evidence(case001))) == []
