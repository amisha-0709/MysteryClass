from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..db import get_db
from ..engine.achievements import ACHIEVEMENTS
from ..engine.case_loader import CaseNotFound, get_case
from ..engine.progression import rank_for
from ..models import Achievement, CaseResult, CaseSession
from ..schemas.public import AchievementOut, HistoryItem, PlayerOut, PlayerUpdate, RankOut
from ..services import count_sessions, current_player

router = APIRouter(prefix="/api/player", tags=["player"])


def _player_out(db: Session) -> PlayerOut:
    p = current_player(db)
    got = {a.code: a.unlocked_at for a in db.exec(select(Achievement).where(Achievement.player_id == p.id))}
    return PlayerOut(
        id=p.id or 0,
        display_name=p.display_name,
        xp=p.xp,
        rank=RankOut(**rank_for(p.xp)),
        cases_closed=count_sessions(db, p.id or 0, "closed"),
        cases_active=count_sessions(db, p.id or 0, "active"),
        achievements=[
            AchievementOut(code=a.code, title=a.title, description=a.description, unlocked_at=got.get(a.code))
            for a in ACHIEVEMENTS
        ],
    )


@router.get("/me", response_model=PlayerOut)
def get_me(db: Session = Depends(get_db)) -> PlayerOut:
    return _player_out(db)


@router.patch("/me", response_model=PlayerOut)
def update_me(body: PlayerUpdate, db: Session = Depends(get_db)) -> PlayerOut:
    p = current_player(db)
    p.display_name = body.display_name.strip() or p.display_name
    db.add(p)
    db.commit()
    return _player_out(db)


@router.get("/history", response_model=list[HistoryItem])
def history(db: Session = Depends(get_db)) -> list[HistoryItem]:
    """Closed investigations, newest first (replays included)."""
    p = current_player(db)
    rows = db.exec(
        select(CaseSession, CaseResult)
        .join(CaseResult, CaseResult.session_id == CaseSession.id)
        .where(CaseSession.player_id == p.id, CaseSession.status == "closed")
        .order_by(CaseResult.created_at.desc())
    )
    out = []
    for cs, res in rows:
        try:
            meta = get_case(cs.case_id).meta
        except CaseNotFound:
            continue
        out.append(
            HistoryItem(
                session_id=cs.id,
                case_id=cs.case_id,
                case_title=meta.title,
                case_number=meta.number,
                solved=res.solved,
                total=res.total,
                xp_awarded=res.xp_awarded,
                closed_at=cs.completed_at or res.created_at,
            )
        )
    return out
