from sqlmodel import Session, select

from app.models import CaseSession, Player


def test_db_rejects_second_active_session(client):
    """The partial unique index is the backstop for concurrent starts."""
    import pytest
    from sqlalchemy.exc import IntegrityError

    from app.db import get_db
    from app.main import app

    client.post("/api/sessions", json={"case_id": "case_001"})
    db: Session = next(app.dependency_overrides[get_db]())
    player = db.exec(select(Player)).first()
    db.add(CaseSession(player_id=player.id, case_id="case_001"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # a closed session alongside the active one is fine
    db.add(CaseSession(player_id=player.id, case_id="case_001", status="closed"))
    db.commit()
