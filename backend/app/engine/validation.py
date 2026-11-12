"""Consistency checks for a case definition.

Run at startup (a broken case refuses to load) and by scripts/validate_case.py.
Checks referential integrity, minimum content, timeline order, and that every evidence
item and every decisive contradiction is actually reachable through the unlock graph.
"""

import re
from collections import Counter

from ..schemas.case import CaseDefinition

MIN_EVIDENCE = 6
MIN_CONTRADICTIONS = 3
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _dupes(ids: list[str]) -> list[str]:
    return [i for i, n in Counter(ids).items() if n > 1]


def parse_trigger(trigger: str) -> tuple[str, list[str]]:
    """'reveal:mehta.spare_key' → ('reveal', ['mehta', 'spare_key'])."""
    kind, _, rest = trigger.partition(":")
    if kind == "reveal":
        return kind, rest.split(".", 1)
    if kind == "confront":
        return kind, rest.split(":", 1)
    return kind, [rest]


def validate_case(case: CaseDefinition) -> list[str]:
    errors: list[str] = []
    suspect_ids = [s.id for s in case.suspects]
    evidence_ids = [e.id for e in case.evidence]
    claim_ids = [c.id for s in case.suspects for c in s.claims]
    contradiction_ids = [c.id for c in case.contradictions]

    # ── uniqueness ──
    for label, ids in [
        ("suspect", suspect_ids),
        ("evidence", evidence_ids),
        ("claim", claim_ids),
        ("contradiction", contradiction_ids),
    ]:
        for d in _dupes(ids):
            errors.append(f"duplicate {label} id: {d}")
    for s in case.suspects:
        for d in _dupes([t.id for t in s.topics]):
            errors.append(f"duplicate topic id {d} on suspect {s.id}")

    # ── minimum content ──
    if len(case.evidence) < MIN_EVIDENCE:
        errors.append(f"need at least {MIN_EVIDENCE} evidence items, have {len(case.evidence)}")
    if len(case.contradictions) < MIN_CONTRADICTIONS:
        errors.append(f"need at least {MIN_CONTRADICTIONS} contradictions, have {len(case.contradictions)}")
    if case.meta.suspect_count != len(case.suspects):
        errors.append(f"meta.suspect_count={case.meta.suspect_count} but {len(case.suspects)} suspects defined")
    if not any(e.unlock.initial for e in case.evidence):
        errors.append("no initial evidence: the player would start with nothing")

    # ── contradictions ──
    for c in case.contradictions:
        if c.claim_id not in claim_ids:
            errors.append(f"{c.id}: unknown claim {c.claim_id}")
        if not c.evidence_ids:
            errors.append(f"{c.id}: no evidence_ids")
        for e in c.evidence_ids:
            if e not in evidence_ids:
                errors.append(f"{c.id}: unknown evidence {e}")

    # ── unlock triggers ──
    topics = {s.id: {t.id for t in s.topics} for s in case.suspects}
    for e in case.evidence:
        if e.unlock.initial and e.unlock.triggers:
            errors.append(f"{e.id}: initial evidence should not also have triggers")
        if not e.unlock.initial and not e.unlock.triggers:
            errors.append(f"{e.id}: not initial and has no unlock triggers (unreachable)")
        for t in e.unlock.triggers:
            kind, parts = parse_trigger(t)
            if kind == "contradiction":
                if parts[0] not in contradiction_ids:
                    errors.append(f"{e.id}: trigger {t} references unknown contradiction")
            elif kind == "evidence":
                if parts[0] not in evidence_ids:
                    errors.append(f"{e.id}: trigger {t} references unknown evidence")
                if parts[0] == e.id:
                    errors.append(f"{e.id}: trigger {t} references itself")
            elif kind == "reveal":
                if len(parts) != 2 or parts[0] not in topics or parts[1] not in topics[parts[0]]:
                    errors.append(f"{e.id}: trigger {t} references unknown suspect topic")
                elif f"{parts[0]}.{parts[1]}" not in _revealable(case):
                    errors.append(f"{e.id}: trigger {t} but no reply ever reveals that topic")
            elif kind == "confront":
                if len(parts) != 2 or parts[0] not in suspect_ids or parts[1] not in evidence_ids:
                    errors.append(f"{e.id}: trigger {t} is malformed or references unknown ids")
            else:
                errors.append(f"{e.id}: unknown trigger kind in {t}")

    # ── dialogue ──
    errors += _validate_dialogue(case, set(evidence_ids))

    # ── hints ──
    for d in _dupes([h.id for h in case.hints]):
        errors.append(f"duplicate hint id: {d}")
    topic_keys = {f"{s.id}.{t.id}" for s in case.suspects for t in s.topics}
    for h in case.hints:
        for cond in h.done_when:
            kind, _, arg = cond.partition(":")
            ok = (
                (kind == "contradiction" and arg in contradiction_ids)
                or (kind == "found" and arg in evidence_ids)
                or (kind == "revealed" and arg in topic_keys)
            )
            if not ok:
                errors.append(f"hint {h.id}: bad done_when {cond!r}")
    if case.hints and case.hints[-1].done_when:
        errors.append(f"hint {case.hints[-1].id}: the last hint must have no done_when (always available)")

    # ── timeline ──
    prev = ""
    for ev in case.timeline:
        if not _TIME.match(ev.time):
            errors.append(f"timeline: bad time {ev.time!r}")
        elif ev.time < prev:
            errors.append(f"timeline: {ev.time} is out of order (after {prev})")
        else:
            prev = ev.time
        for e in ev.evidence_ids:
            if e not in evidence_ids:
                errors.append(f"timeline {ev.time}: unknown evidence {e}")

    # ── solution ──
    sol = case.solution
    if sol.culprit_id not in suspect_ids:
        errors.append(f"solution: unknown culprit {sol.culprit_id}")
    for e in sol.decisive_evidence:
        if e not in evidence_ids:
            errors.append(f"solution: unknown decisive evidence {e}")
    for e in sol.supporting_evidence:
        if e not in evidence_ids:
            errors.append(f"solution: unknown supporting evidence {e}")
        if e in sol.decisive_evidence:
            errors.append(f"solution: {e} is both decisive and supporting")
    for c in sol.decisive_contradictions:
        match = next((x for x in case.contradictions if x.id == c), None)
        if match is None:
            errors.append(f"solution: unknown decisive contradiction {c}")
        elif not match.decisive:
            errors.append(f"solution: {c} listed as decisive but contradiction.decisive is false")
    expected_innocents = set(suspect_ids) - {sol.culprit_id}
    if set(sol.innocents) != expected_innocents:
        errors.append(f"solution.innocents must cover exactly {sorted(expected_innocents)}")
    culprit_claims = {c.id for c in (case.suspect(sol.culprit_id).claims if case.suspect(sol.culprit_id) else [])}
    if not any(
        x.claim_id in culprit_claims for x in case.contradictions if x.id in sol.decisive_contradictions
    ):
        errors.append("solution: no decisive contradiction exposes the culprit's own statement")

    # ── reachability (only if references are sound) ──
    if not errors:
        reachable = reachable_evidence(case)
        for e in case.evidence:
            if e.id not in reachable:
                errors.append(f"{e.id}: unreachable through the unlock graph")
        for c in case.contradictions:
            if c.decisive and not set(c.evidence_ids) & reachable:
                errors.append(f"{c.id}: decisive contradiction can never be proven")

    return errors


CONDITION_KINDS = {"presented", "showing", "found", "revealed", "asked"}


def _revealable(case: CaseDefinition) -> set[str]:
    return {f"{s.id}.{t}" for s in case.suspects for tp in s.topics for r in tp.replies for t in r.reveals}


def _validate_dialogue(case: CaseDefinition, evidence_ids: set[str]) -> list[str]:
    errors: list[str] = []
    topic_keys = {f"{s.id}.{t.id}" for s in case.suspects for t in s.topics}
    for s in case.suspects:
        if s.lines is None:
            errors.append(f"{s.id}: no dialogue lines (greeting, story, ...) in dialogue.json")
        own = {t.id for t in s.topics}
        for t in s.topics:
            where = f"{s.id}.{t.id}"
            if not t.keywords and not t.evidence:
                errors.append(f"{where}: topic can never be reached (no keywords, no evidence)")
            if any(k != k.lower() for k in t.keywords):
                errors.append(f"{where}: keywords must be lowercase")
            for e in t.evidence:
                if e not in evidence_ids:
                    errors.append(f"{where}: unknown evidence {e}")
            for d in _dupes([r.id for r in t.replies]):
                errors.append(f"{where}: duplicate reply id {d}")
            if t.replies[0].when:
                errors.append(f"{where}: the first reply must have no conditions (it is the default)")
            for r in t.replies:
                for rv in r.reveals:
                    if rv not in own:
                        errors.append(f"{where}.{r.id}: reveals unknown topic {rv}")
                for c in r.when:
                    kind, _, arg = c.partition(":")
                    if kind not in CONDITION_KINDS or not arg:
                        errors.append(f"{where}.{r.id}: bad condition {c!r}")
                    elif kind == "asked":
                        if not arg.isdigit():
                            errors.append(f"{where}.{r.id}: asked needs a number, got {c!r}")
                    else:
                        for opt in arg.split("|"):
                            if kind == "revealed" and opt not in topic_keys:
                                errors.append(f"{where}.{r.id}: {c!r} references unknown topic")
                            if kind != "revealed" and opt not in evidence_ids:
                                errors.append(f"{where}.{r.id}: {c!r} references unknown evidence")
                            if kind == "showing" and opt not in t.evidence:
                                errors.append(f"{where}.{r.id}: {c!r} can never fire: {opt} isn't routed to this topic")
    return errors


def _reply_reachable(cond_list: list[str], unlocked: set[str], revealed: set[str]) -> bool:
    for c in cond_list:
        kind, _, arg = c.partition(":")
        opts = arg.split("|")
        if kind in {"presented", "showing", "found"} and not set(opts) & unlocked:
            return False
        if kind == "revealed" and not set(opts) & revealed:
            return False
    return True


def reachable_evidence(case: CaseDefinition) -> set[str]:
    """Fixpoint over the unlock graph AND the dialogue: a topic counts as revealed only if some reply
    that reveals it has conditions the player can actually meet with evidence found so far."""
    unlocked = {e.id for e in case.evidence if e.unlock.initial}
    revealed: set[str] = set()
    changed = True
    while changed:
        changed = False
        for s in case.suspects:
            for t in s.topics:
                for r in t.replies:
                    keys = {f"{s.id}.{x}" for x in r.reveals} - revealed
                    if keys and _reply_reachable(r.when, unlocked, revealed):
                        revealed |= keys
                        changed = True
        provable = {c.id for c in case.contradictions if set(c.evidence_ids) & unlocked}
        for e in case.evidence:
            if e.id in unlocked:
                continue
            for t in e.unlock.triggers:
                kind, parts = parse_trigger(t)
                ok = (
                    (kind == "reveal" and ".".join(parts) in revealed)
                    or (kind == "contradiction" and parts[0] in provable)
                    or (kind == "evidence" and parts[0] in unlocked)
                    or (kind == "confront" and parts[1] in unlocked)
                )
                if ok:
                    unlocked.add(e.id)
                    changed = True
                    break
    return unlocked
