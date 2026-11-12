from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from ..db import get_db
from ..engine import public_view
from ..models import Note, utcnow
from ..schemas.public import NoteIn, NoteOut, SessionState, StartSession
from ..services import session_or_404, session_state, start_or_resume

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionState)
def start(body: StartSession, db: Session = Depends(get_db)) -> SessionState:
    """Start a new investigation for the case, or resume the active one."""
    return session_state(db, start_or_resume(db, body.case_id))


@router.get("/{session_id}", response_model=SessionState)
def get_state(session_id: str, db: Session = Depends(get_db)) -> SessionState:
    return session_state(db, session_or_404(db, session_id))


@router.post("/{session_id}/briefing-complete", response_model=SessionState)
def complete_briefing(session_id: str, db: Session = Depends(get_db)) -> SessionState:
    cs = session_or_404(db, session_id)
    if not cs.briefing_done:
        cs.briefing_done = True
        cs.updated_at = utcnow()
        db.add(cs)
        db.commit()
    return session_state(db, cs)


@router.post("/{session_id}/notes", response_model=NoteOut, status_code=201)
def add_note(session_id: str, body: NoteIn, db: Session = Depends(get_db)) -> NoteOut:
    cs = session_or_404(db, session_id)
    if cs.status != "active":
        raise HTTPException(status_code=409, detail="This investigation is closed.")
    note = Note(session_id=cs.id, text=body.text.strip())
    db.add(note)
    db.commit()
    db.refresh(note)
    return public_view.note(note)


@router.delete("/{session_id}/notes/{note_id}", status_code=204)
def delete_note(session_id: str, note_id: int, db: Session = Depends(get_db)) -> Response:
    cs = session_or_404(db, session_id)
    note = db.get(Note, note_id)
    if note is None or note.session_id != cs.id:
        raise HTTPException(status_code=404, detail="Note not found.")
    db.delete(note)
    db.commit()
    return Response(status_code=204)
