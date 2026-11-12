from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..db import get_db
from ..engine import public_view
from ..engine.case_loader import all_cases
from ..models import CaseSession
from ..schemas.public import CaseListItem
from ..services import current_player

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("", response_model=list[CaseListItem])
def list_cases(db: Session = Depends(get_db)) -> list[CaseListItem]:
    player = current_player(db)
    sessions = list(db.exec(select(CaseSession).where(CaseSession.player_id == player.id)))
    out = []
    for case in all_cases():
        mine = [s for s in sessions if s.case_id == case.meta.id]
        active = next((s for s in mine if s.status == "active"), None)
        closed = next((s for s in mine if s.status == "closed"), None)
        status, sid = ("active", active.id) if active else ("closed", closed.id) if closed else ("new", None)
        out.append(CaseListItem(**public_view.case_summary(case.meta).model_dump(), status=status, session_id=sid))
    return out
