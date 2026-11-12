"""Evidence board: test a claim against evidence, take a hint, keep a timeline.

All checks happen here. The client is told only whether a pair holds; it is never told which pairs
are worth trying, how close a wrong guess was, or which contradictions matter for the verdict.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..db import get_db
from ..engine import board as rules
from ..engine import public_view
from ..models import CaseSession, HintUsed, LinkAttempt, TimelineEntry, UnlockedEvidence, utcnow
from ..schemas.public import HintOut, LinkIn, LinkOut, TimelineEntryOut, TimelineIn
from ..services import (
    board_state,
    case_or_404,
    fire_trigger,
    found_contradiction_ids,
    revealed_topics,
    session_or_404,
    unlocked_ids,
)

router = APIRouter(prefix="/api/sessions/{session_id}/board", tags=["board"])


def _open_session(db: Session, session_id: str) -> CaseSession:
    cs = session_or_404(db, session_id)
    if cs.status != "active":
        raise HTTPException(status_code=409, detail="This investigation is closed.")
    if not cs.briefing_done:
        raise HTTPException(status_code=409, detail="Finish the briefing first.")
    return cs


@router.post("/links", response_model=LinkOut)
def test_link(session_id: str, body: LinkIn, db: Session = Depends(get_db)) -> LinkOut:
    cs = _open_session(db, session_id)
    case = case_or_404(cs.case_id)
    if case.claim(body.claim_id) is None:
        raise HTTPException(status_code=404, detail="No such statement.")
    if body.evidence_id not in unlocked_ids(db, cs.id):
        raise HTTPException(status_code=400, detail="You haven't found that evidence yet.")

    existing = db.exec(
        select(LinkAttempt).where(
            LinkAttempt.session_id == cs.id,
            LinkAttempt.claim_id == body.claim_id,
            LinkAttempt.evidence_id == body.evidence_id,
        )
    ).first()
    match = rules.match_contradiction(case, body.claim_id, body.evidence_id)

    if existing is not None:
        result = "already_found" if match else "already_tried"
        return LinkOut(result=result, board=board_state(db, case, cs))
    if match and match.id in found_contradiction_ids(db, cs.id):
        # Same contradiction, other supporting evidence: record it (no cost), nothing new to unlock.
        db.add(LinkAttempt(session_id=cs.id, claim_id=body.claim_id, evidence_id=body.evidence_id, contradiction_id=match.id))
        db.commit()
        return LinkOut(result="already_found", board=board_state(db, case, cs))

    db.add(
        LinkAttempt(
            session_id=cs.id,
            claim_id=body.claim_id,
            evidence_id=body.evidence_id,
            contradiction_id=match.id if match else None,
        )
    )
    cs.updated_at = utcnow()
    db.add(cs)
    try:
        db.commit()
    except IntegrityError:  # a double-click raced us; the first one counts
        db.rollback()
        return LinkOut(result="already_found" if match else "already_tried", board=board_state(db, case, cs))

    if match is None:
        return LinkOut(result="no_contradiction", board=board_state(db, case, cs))

    new_ids = fire_trigger(db, cs, f"contradiction:{match.id}")
    rows = (
        list(
            db.exec(
                select(UnlockedEvidence).where(
                    UnlockedEvidence.session_id == cs.id, UnlockedEvidence.evidence_id.in_(new_ids)
                )
            )
        )
        if new_ids
        else []
    )
    board = board_state(db, case, cs)
    return LinkOut(
        result="contradiction",
        contradiction=next(c for c in board.found if c.id == match.id),
        new_evidence=public_view.unlocked_evidence(case, rows),
        board=board,
    )


@router.post("/hint", response_model=HintOut)
def take_hint(session_id: str, db: Session = Depends(get_db)) -> HintOut:
    """Give the first hint that isn't done yet. Repeating an already-paid hint is free."""
    cs = _open_session(db, session_id)
    case = case_or_404(cs.case_id)
    hint = rules.next_hint(
        case, found_contradiction_ids(db, cs.id), unlocked_ids(db, cs.id), revealed_topics(db, case, cs.id)
    )
    if hint is None:
        return HintOut(hint=None, charged=False, board=board_state(db, case, cs))

    paid = db.exec(select(HintUsed).where(HintUsed.session_id == cs.id, HintUsed.hint_id == hint.id)).first()
    if paid is not None:
        return HintOut(hint=hint.text, charged=False, board=board_state(db, case, cs))
    if cs.hints_used >= rules.HINT_LIMIT:
        return HintOut(hint=None, charged=False, board=board_state(db, case, cs))

    db.add(HintUsed(session_id=cs.id, hint_id=hint.id))
    cs.hints_used += 1
    cs.updated_at = utcnow()
    db.add(cs)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return HintOut(hint=hint.text, charged=False, board=board_state(db, case, cs))
    return HintOut(hint=hint.text, charged=True, board=board_state(db, case, cs))


@router.post("/timeline", response_model=TimelineEntryOut, status_code=201)
def add_timeline(session_id: str, body: TimelineIn, db: Session = Depends(get_db)) -> TimelineEntryOut:
    cs = _open_session(db, session_id)
    if body.evidence_id is not None and body.evidence_id not in unlocked_ids(db, cs.id):
        raise HTTPException(status_code=400, detail="You haven't found that evidence yet.")
    entry = TimelineEntry(session_id=cs.id, time=body.time, text=body.text.strip(), evidence_id=body.evidence_id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return TimelineEntryOut(id=entry.id or 0, time=entry.time, text=entry.text, evidence_id=entry.evidence_id)


@router.delete("/timeline/{entry_id}", status_code=204)
def delete_timeline(session_id: str, entry_id: int, db: Session = Depends(get_db)) -> Response:
    cs = _open_session(db, session_id)
    entry = db.get(TimelineEntry, entry_id)
    if entry is None or entry.session_id != cs.id:
        raise HTTPException(status_code=404, detail="Timeline entry not found.")
    db.delete(entry)
    db.commit()
    return Response(status_code=204)
