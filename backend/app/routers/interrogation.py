"""Interrogation: ask a suspect a question (typed or spoken), optionally while showing evidence.

The server is the referee: it checks the evidence has actually been found, picks the authored reply,
records the turn, and applies unlock triggers (confront:<suspect>:<evidence>, reveal:<suspect>.<topic>).
Only the chosen reply ever leaves the server.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_db
from ..engine import interrogation as engine
from ..engine import public_view
from ..models import CaseSession, InterrogationTurn, UnlockedEvidence, utcnow
from ..schemas.case import CaseDefinition
from ..schemas.public import AskIn, AskOut, TurnOut
from ..services import case_or_404, fire_trigger, session_or_404, unlocked_ids

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["interrogation"])


def _turns(db: Session, session_id: str) -> list[InterrogationTurn]:
    return list(
        db.exec(
            select(InterrogationTurn)
            .where(InterrogationTurn.session_id == session_id)
            .order_by(InterrogationTurn.id)
        )
    )


def build_memory(case: CaseDefinition, turns: list[InterrogationTurn], suspect_id: str, found: set[str]) -> engine.Memory:
    mem = engine.Memory(found=found)
    for t in turns:
        resolved = engine.reply_text(case, t.response_id)
        if resolved:
            mem.revealed |= set(resolved[2])
        if t.suspect_id != suspect_id:
            continue
        if t.evidence_id:
            mem.presented.add(t.evidence_id)
        if t.topic_id:
            mem.asked[t.topic_id] += 1
        elif ".line.unknown." in t.response_id:
            mem.unknown_count += 1
        mem.last_topic = t.topic_id  # a general line resets the follow-up context
    return mem


def turn_out(case: CaseDefinition, t: InterrogationTurn) -> TurnOut:
    resolved = engine.reply_text(case, t.response_id)
    ev = case.evidence_item(t.evidence_id) if t.evidence_id else None
    return TurnOut(
        id=t.id,
        suspect_id=t.suspect_id,
        question=t.question,
        mode=t.mode,
        evidence_id=t.evidence_id,
        evidence_title=ev.title if ev else None,
        reply=resolved[1] if resolved else "…",
        clip_id=f"reply.{t.response_id}",
        revealed=t.revealed,
        created_at=t.created_at,
    )


@router.get("/turns", response_model=list[TurnOut])
def list_turns(session_id: str, suspect_id: str | None = None, db: Session = Depends(get_db)) -> list[TurnOut]:
    cs = session_or_404(db, session_id)
    case = case_or_404(cs.case_id)
    return [turn_out(case, t) for t in _turns(db, cs.id) if suspect_id in (None, t.suspect_id)]


@router.post("/suspects/{suspect_id}/ask", response_model=AskOut)
def ask(session_id: str, suspect_id: str, body: AskIn, db: Session = Depends(get_db)) -> AskOut:
    cs: CaseSession = session_or_404(db, session_id)
    case = case_or_404(cs.case_id)
    if cs.status != "active":
        raise HTTPException(status_code=409, detail="This investigation is closed.")
    if not cs.briefing_done:
        raise HTTPException(status_code=409, detail="Finish the briefing first.")
    suspect = case.suspect(suspect_id)
    if suspect is None:
        raise HTTPException(status_code=404, detail="No such suspect.")

    question = " ".join(body.question.split())
    found = unlocked_ids(db, cs.id)
    if body.evidence_id is not None and body.evidence_id not in found:
        raise HTTPException(status_code=400, detail="You haven't found that evidence yet.")
    if not question and body.evidence_id is None:
        raise HTTPException(status_code=422, detail="Ask a question or show some evidence.")

    turns = _turns(db, cs.id)
    mem = build_memory(case, turns, suspect.id, found)
    ans = engine.answer(case, suspect, question, mem, showing=body.evidence_id)

    turn = InterrogationTurn(
        session_id=cs.id,
        suspect_id=suspect.id,
        question=question,
        mode=body.mode,
        evidence_id=body.evidence_id,
        topic_id=ans.topic_id,
        response_id=ans.response_id,
        revealed=bool(set(ans.reveals) - mem.revealed),
    )
    db.add(turn)
    cs.updated_at = utcnow()
    db.add(cs)
    db.commit()
    db.refresh(turn)

    new_ids: list[str] = []
    if body.evidence_id:
        new_ids += fire_trigger(db, cs, f"confront:{suspect.id}:{body.evidence_id}")
    for key in ans.reveals:
        new_ids += fire_trigger(db, cs, f"reveal:{key}")

    rows = []
    if new_ids:
        rows = list(
            db.exec(
                select(UnlockedEvidence).where(
                    UnlockedEvidence.session_id == cs.id, UnlockedEvidence.evidence_id.in_(new_ids)
                )
            )
        )
    return AskOut(turn=turn_out(case, turn), new_evidence=public_view.unlocked_evidence(case, rows))
