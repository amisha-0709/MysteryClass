"""Final accusation and resolution.

Accusing is final: the server scores the whole investigation, closes the session, awards XP and
achievements, and only THEN does the answer key (culprit, method, every contradiction) become
available through GET /resolution.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..db import get_db
from ..engine import achievements as ach
from ..engine import public_view
from ..engine.progression import rank_for
from ..engine.scoring import Investigation, score, xp_for
from ..models import Accusation, Achievement, CaseResult, CaseSession, Player, utcnow
from ..schemas.case import CaseDefinition
from ..schemas.public import (
    AccuseIn,
    AchievementOut,
    InnocentOut,
    ResolutionOut,
    RevealedContradiction,
    RevealedEvent,
    ScoreOut,
    YourAccusation,
)
from ..services import (
    board_state,
    case_or_404,
    current_player,
    revealed_topics,
    session_or_404,
    unlocked_ids,
)

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["accusation"])

DEFS = {a.code: a for a in ach.ACHIEVEMENTS}


def _evidence_label(case: CaseDefinition, eid: str) -> str:
    e = case.evidence_item(eid)
    return f"{eid} · {e.title}" if e else eid


def _best_previous_xp(db: Session, player_id: int, case_id: str, exclude: str) -> int:
    rows = db.exec(
        select(CaseResult.xp_earned)
        .join(CaseSession, CaseSession.id == CaseResult.session_id)
        .where(CaseSession.player_id == player_id, CaseSession.case_id == case_id, CaseSession.id != exclude)
    )
    return max(rows, default=0)


@router.post("/accuse", response_model=ResolutionOut)
def accuse(session_id: str, body: AccuseIn, db: Session = Depends(get_db)) -> ResolutionOut:
    cs = session_or_404(db, session_id)
    case = case_or_404(cs.case_id)
    if cs.status != "active":
        raise HTTPException(status_code=409, detail="This case is already closed.")
    if not cs.briefing_done:
        raise HTTPException(status_code=409, detail="Finish the briefing first.")
    if case.suspect(body.suspect_id) is None:
        raise HTTPException(status_code=404, detail="No such suspect.")
    explanation = body.explanation.strip()
    if not explanation:
        raise HTTPException(status_code=422, detail="Explain how it was done.")

    found = unlocked_ids(db, cs.id)
    selected = list(dict.fromkeys(body.evidence_ids))
    unknown = [e for e in selected if e not in found]
    if unknown:
        raise HTTPException(status_code=400, detail="You can only cite evidence you've found.")
    board = board_state(db, case, cs)
    proven = {f.id for f in board.found}
    if body.contradiction_id is not None and body.contradiction_id not in proven:
        raise HTTPException(status_code=400, detail="You can only cite a contradiction you've proven.")

    inv = Investigation(
        accused=body.suspect_id,
        explanation=explanation,
        selected_evidence=selected,
        proven=proven,
        wrong_links=board.wrong_attempts,
        hints_used=cs.hints_used,
        revealed=revealed_topics(db, case, cs.id),
        evidence_found=found,
    )
    report = score(case, inv)

    player = db.get(Player, cs.player_id) or current_player(db)
    earned_xp = xp_for(report)
    awarded = max(0, earned_xp - _best_previous_xp(db, player.id or 0, case.meta.id, cs.id))
    rank_before = rank_for(player.xp)["name"]
    have = set(db.exec(select(Achievement.code).where(Achievement.player_id == player.id)))
    new_codes = [c for c in (a.code for a in ach.ACHIEVEMENTS) if c in ach.earned(case, inv, report) - have]

    now = utcnow()
    db.add(
        Accusation(
            session_id=cs.id,
            suspect_id=body.suspect_id,
            explanation=explanation,
            mode=body.mode,
            evidence_ids=",".join(selected),
            contradiction_id=body.contradiction_id,
        )
    )
    player.xp += awarded
    db.add(
        CaseResult(
            session_id=cs.id,
            total=report.total,
            solved=report.solved,
            report_json=json.dumps(report.to_dict()),
            xp_earned=earned_xp,
            xp_awarded=awarded,
            rank_before=rank_before,
            rank_after=rank_for(player.xp)["name"],
            new_achievements=",".join(new_codes),
        )
    )
    for code in new_codes:
        db.add(Achievement(player_id=player.id or 0, code=code, session_id=cs.id))
    cs.status = "closed"
    cs.completed_at = now
    cs.updated_at = now
    db.add(cs)
    db.add(player)
    try:
        db.commit()
    except IntegrityError:  # a second submit raced the first; the first one stands
        db.rollback()
        db.refresh(cs)
        if cs.status != "closed":
            raise
    return build_resolution(db, case, cs)


@router.get("/resolution", response_model=ResolutionOut)
def resolution(session_id: str, db: Session = Depends(get_db)) -> ResolutionOut:
    cs = session_or_404(db, session_id)
    if cs.status != "closed":
        raise HTTPException(status_code=409, detail="The case is still open. Make your accusation first.")
    return build_resolution(db, case_or_404(cs.case_id), cs)


def build_resolution(db: Session, case: CaseDefinition, cs: CaseSession) -> ResolutionOut:
    acc = db.exec(select(Accusation).where(Accusation.session_id == cs.id)).first()
    result = db.exec(select(CaseResult).where(CaseResult.session_id == cs.id)).first()
    if acc is None or result is None:
        raise HTTPException(status_code=409, detail="This case was closed without an accusation.")

    sol = case.solution
    names = {s.id: s.name for s in case.suspects}
    found = unlocked_ids(db, cs.id)
    proven = {f.id for f in board_state(db, case, cs).found}
    unlocked_at = {
        a.code: a.unlocked_at
        for a in db.exec(select(Achievement).where(Achievement.player_id == cs.player_id))
    }

    contradictions = []
    for c in case.contradictions:
        owner, claim = case.claim(c.claim_id) or (None, None)
        contradictions.append(
            RevealedContradiction(
                id=c.id,
                suspect_name=owner.name if owner else "",
                claim=claim.text if claim else "",
                evidence=[_evidence_label(case, e) for e in c.evidence_ids],
                explanation=c.explanation,
                decisive=c.decisive,
                points=c.points,
                found=c.id in proven,
            )
        )

    return ResolutionOut(
        case=public_view.case_summary(case.meta),
        correct=result.solved,
        culprit_id=sol.culprit_id,
        culprit_name=names[sol.culprit_id],
        summary=sol.summary,
        motive=sol.motive,
        method=list(sol.method),
        innocents=[InnocentOut(suspect_id=k, name=names[k], explanation=v) for k, v in sol.innocents.items()],
        contradictions=contradictions,
        timeline=[
            RevealedEvent(
                time=t.time,
                text=t.text,
                evidence_ids=list(t.evidence_ids),
                you_found=bool(t.evidence_ids) and set(t.evidence_ids) <= found,
            )
            for t in case.timeline
        ],
        accusation=YourAccusation(
            suspect_id=acc.suspect_id,
            suspect_name=names.get(acc.suspect_id, acc.suspect_id),
            explanation=acc.explanation,
            mode=acc.mode,
            evidence=[_evidence_label(case, e) for e in acc.evidence_ids.split(",") if e],
            contradiction=acc.contradiction_id,
        ),
        score=ScoreOut.model_validate(json.loads(result.report_json)),
        xp_earned=result.xp_earned,
        xp_awarded=result.xp_awarded,
        rank_before=result.rank_before,
        rank_after=result.rank_after,
        new_achievements=[
            AchievementOut(
                code=c, title=DEFS[c].title, description=DEFS[c].description, unlocked_at=unlocked_at.get(c)
            )
            for c in result.new_achievements.split(",")
            if c in DEFS
        ],
        clip_id="resolution",
    )
