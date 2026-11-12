"""Shared game-state operations used by routers (and later by the interrogation/board engines)."""

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from .engine import board as board_rules
from .engine import public_view
from .engine.case_loader import CaseNotFound, get_case
from .engine.interrogation import reply_text
from .engine.unlocks import initial_evidence, resolve_unlocks
from .models import (
    CaseSession,
    HintUsed,
    InterrogationTurn,
    LinkAttempt,
    Note,
    Player,
    TimelineEntry,
    UnlockedEvidence,
    utcnow,
)
from .schemas.case import CaseDefinition
from .schemas.public import (
    BoardRules,
    BoardState,
    FoundContradiction,
    Progress,
    SessionState,
    TimelineEntryOut,
)


def current_player(db: Session) -> Player:
    """Single local profile for the MVP: the first player row, created on demand."""
    player = db.exec(select(Player).order_by(Player.id)).first()
    if player is None:
        player = Player()
        db.add(player)
        db.commit()
        db.refresh(player)
    return player


def case_or_404(case_id: str) -> CaseDefinition:
    try:
        return get_case(case_id)
    except CaseNotFound:
        raise HTTPException(status_code=404, detail="Case not found.") from None


def session_or_404(db: Session, session_id: str) -> CaseSession:
    player = current_player(db)
    cs = db.get(CaseSession, session_id)
    if cs is None or cs.player_id != player.id:
        raise HTTPException(status_code=404, detail="Investigation not found.")
    return cs


def _active_session(db: Session, player_id: int, case_id: str) -> CaseSession | None:
    return db.exec(
        select(CaseSession).where(
            CaseSession.player_id == player_id, CaseSession.case_id == case_id, CaseSession.status == "active"
        )
    ).first()


def start_or_resume(db: Session, case_id: str) -> CaseSession:
    case = case_or_404(case_id)
    player = current_player(db)
    existing = _active_session(db, player.id, case_id)
    if existing:
        return existing

    cs = CaseSession(player_id=player.id, case_id=case_id)
    try:
        db.add(cs)
        db.flush()  # hits uq_active_session if a concurrent request already created one
        for eid in initial_evidence(case):
            db.add(UnlockedEvidence(session_id=cs.id, evidence_id=eid, source="initial"))
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = _active_session(db, player.id, case_id)
        if winner is None:
            raise
        return winner
    db.refresh(cs)
    return cs


def unlocked_ids(db: Session, session_id: str) -> set[str]:
    return set(db.exec(select(UnlockedEvidence.evidence_id).where(UnlockedEvidence.session_id == session_id)))


def fire_trigger(db: Session, cs: CaseSession, trigger: str) -> list[str]:
    """Apply an unlock trigger to a session; persists and returns newly unlocked evidence ids."""
    case = case_or_404(cs.case_id)
    new = resolve_unlocks(case, trigger, unlocked_ids(db, cs.id))
    for eid in new:
        db.add(UnlockedEvidence(session_id=cs.id, evidence_id=eid, source=trigger))
    if new:
        cs.updated_at = utcnow()
        db.add(cs)
    db.commit()
    return new


def revealed_topics(db: Session, case: CaseDefinition, session_id: str) -> set[str]:
    """Every "<suspect>.<topic>" a suspect has let slip in this session."""
    out: set[str] = set()
    for rid in db.exec(select(InterrogationTurn.response_id).where(InterrogationTurn.session_id == session_id)):
        resolved = reply_text(case, rid)
        if resolved:
            out |= set(resolved[2])
    return out


def link_attempts(db: Session, session_id: str) -> list[LinkAttempt]:
    return list(db.exec(select(LinkAttempt).where(LinkAttempt.session_id == session_id).order_by(LinkAttempt.id)))


def found_contradiction_ids(db: Session, session_id: str) -> set[str]:
    return {a.contradiction_id for a in link_attempts(db, session_id) if a.contradiction_id}


def board_state(db: Session, case: CaseDefinition, cs: CaseSession) -> BoardState:
    attempts = link_attempts(db, cs.id)
    found: list[FoundContradiction] = []
    seen: set[str] = set()
    for a in attempts:
        if a.contradiction_id and a.contradiction_id not in seen:
            c = next(x for x in case.contradictions if x.id == a.contradiction_id)
            seen.add(c.id)
            found.append(
                FoundContradiction(
                    id=c.id, claim_id=a.claim_id, evidence_id=a.evidence_id, explanation=c.explanation, found_at=a.created_at
                )
            )
    hint_rows = list(db.exec(select(HintUsed).where(HintUsed.session_id == cs.id).order_by(HintUsed.id)))
    hint_text = {h.id: h.text for h in case.hints}
    timeline = list(
        db.exec(
            select(TimelineEntry)
            .where(TimelineEntry.session_id == cs.id)
            .order_by(TimelineEntry.time, TimelineEntry.id)
        )
    )
    return BoardState(
        found=found,
        wrong_attempts=sum(1 for a in attempts if a.contradiction_id is None),
        tried=[(a.claim_id, a.evidence_id) for a in attempts],
        hints=[hint_text[h.hint_id] for h in hint_rows if h.hint_id in hint_text],
        my_timeline=[TimelineEntryOut(id=t.id or 0, time=t.time, text=t.text, evidence_id=t.evidence_id) for t in timeline],
        rules=BoardRules(
            free_wrong_links=board_rules.FREE_WRONG_LINKS,
            wrong_link_cap=board_rules.WRONG_LINK_CAP,
            hint_cost=board_rules.HINT_COST,
            hint_limit=board_rules.HINT_LIMIT,
        ),
    )


def session_state(db: Session, cs: CaseSession) -> SessionState:
    case = case_or_404(cs.case_id)
    rows = list(db.exec(select(UnlockedEvidence).where(UnlockedEvidence.session_id == cs.id)))
    notes = list(db.exec(select(Note).where(Note.session_id == cs.id).order_by(Note.created_at)))
    evidence = public_view.unlocked_evidence(case, rows)
    return SessionState(
        id=cs.id,
        case=public_view.case_summary(case.meta),
        briefing=public_view.briefing(case),
        suspects=[public_view.suspect(s) for s in case.suspects],
        evidence=evidence,
        notes=[public_view.note(n) for n in notes],
        progress=Progress(
            briefing_done=cs.briefing_done,
            status=cs.status,
            evidence_found=len(evidence),
            evidence_total=len(case.evidence),
        ),
        board=board_state(db, case, cs),
    )


def count_sessions(db: Session, player_id: int, status: str) -> int:
    return db.exec(
        select(func.count()).select_from(CaseSession).where(
            CaseSession.player_id == player_id, CaseSession.status == status
        )
    ).one()
