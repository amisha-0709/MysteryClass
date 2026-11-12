from typing import Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_db
from ..models import InterrogationTurn
from ..services import case_or_404, session_or_404
from ..voice import stt
from ..voice.audio_utils import AudioRejected, check_upload
from ..voice.clips import resolution_clip, resolve_clip, resolve_reply_clip
from ..voice.gnani_client import GnaniClient, GnaniError, get_gnani
from ..voice.tts import TtsService, get_tts

router = APIRouter(prefix="/api/voice", tags=["voice"])

ERROR_STATUS = {
    "not_configured": 503,
    "busy": 429,
    "timeout": 504,
    "too_long": 422,
    "too_short": 422,
    "silent": 422,
    "empty": 422,
    "bad_audio": 422,
    "not_found": 404,
}


class SttOut(BaseModel):
    transcript: str
    empty: bool
    model: str
    latency_ms: int
    truncated: bool


class VoiceStatus(BaseModel):
    stt: bool
    tts: bool
    stt_model: str
    max_seconds: float


# Voice playback failures: the player can always read the line instead, and a bad body from Gnani is
# an upstream fault (502), not a problem with anything the player sent.
TTS_MESSAGES = {
    "busy": "The voice service is busy. Try again in a moment, or read the transcript.",
    "timeout": "The voice took too long to arrive. Try again, or read the transcript.",
    "network": "Couldn't reach the voice service. Read the transcript instead.",
    "credits": "The voice service is out of credits. Read the transcript instead.",
    "auth": "The voice service rejected our credentials. Read the transcript instead.",
}
TTS_STATUS = {"busy": 429, "timeout": 504, "not_configured": 503}


def _tts_error(e: GnaniError) -> JSONResponse:
    message = TTS_MESSAGES.get(e.code, "This recording isn't available right now. Read the transcript instead.")
    return JSONResponse(status_code=TTS_STATUS.get(e.code, 502), content={"detail": message, "code": e.code})


def _error(code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=ERROR_STATUS.get(code, 502), content={"detail": message, "code": code})


@router.get("/status", response_model=VoiceStatus)
def status(gnani: GnaniClient = Depends(get_gnani), tts: TtsService = Depends(get_tts)) -> VoiceStatus:
    from ..voice.audio_utils import MAX_SECONDS

    s = get_settings()
    return VoiceStatus(stt=gnani.configured, tts=tts.configured, stt_model=s.stt_model, max_seconds=MAX_SECONDS)


@router.post("/stt", response_model=SttOut, responses={422: {}, 429: {}, 502: {}, 503: {}, 504: {}})
async def speech_to_text(
    audio: UploadFile = File(...),
    session_id: str | None = Form(default=None),
    purpose: Literal["question", "accusation", "check"] = Form(default="question"),
    db: Session = Depends(get_db),
    gnani: GnaniClient = Depends(get_gnani),
):
    """Transcribe one recording (≤30 s). Biased toward the case's names/places when a session is given."""
    if not gnani.configured:
        return _error("not_configured", "Voice isn't configured on the server. You can type instead.")

    data = await audio.read()
    try:
        ext = check_upload(data, audio.content_type)
    except AudioRejected as e:
        return _error(e.code, str(e))

    keyterms: list[str] = []
    topic: str | None = None
    if session_id:
        case = case_or_404(session_or_404(db, session_id).case_id)
        keyterms, topic = case.stt.keyterms, case.stt.topic or None

    s = get_settings()
    try:
        result = await stt.transcribe(
            gnani,
            data,
            filename=f"{purpose}{ext}",
            content_type=(audio.content_type or "application/octet-stream").split(";")[0],
            language=s.stt_language,
            preferred_model=s.stt_model,
            keyterms=keyterms,
            topic=topic,
            timeout=s.stt_timeout_s,
        )
    except GnaniError as e:
        return _error(e.code, e.user_message)

    return SttOut(
        transcript=result.transcript,
        empty=not result.transcript,
        model=result.model,
        latency_ms=result.latency_ms,
        truncated=result.truncated,
    )


@router.get(
    "/sessions/{session_id}/clips/{clip_id}",
    response_class=FileResponse,
    responses={200: {"content": {"audio/wav": {}}}, 404: {}, 429: {}, 502: {}, 503: {}, 504: {}},
)
async def clip_audio(
    session_id: str,
    clip_id: str,
    db: Session = Depends(get_db),
    tts: TtsService = Depends(get_tts),
):
    """Speak one authored line (see voice/clips.py) in its character's voice. Cached clips cost nothing."""
    cs = session_or_404(db, session_id)
    case = case_or_404(cs.case_id)
    spec = resolve_clip(case, clip_id)
    if spec is None and clip_id.startswith("reply."):
        heard = db.exec(
            select(InterrogationTurn.id).where(
                InterrogationTurn.session_id == cs.id,
                InterrogationTurn.response_id == clip_id.removeprefix("reply."),
            )
        ).first()
        spec = resolve_reply_clip(case, clip_id) if heard is not None else None
    if spec is None and clip_id == "resolution" and cs.status == "closed":
        spec = resolution_clip(case)
    if spec is None:
        return _error("not_found", "That recording doesn't exist.")

    path = tts.cached(spec.voice, spec.text)
    cached = path is not None
    if path is None:
        if not tts.configured:
            return _error("not_configured", "Voice isn't configured on the server. Read the transcript instead.")
        try:
            path = (await tts.speak(spec.voice, spec.text)).path
        except GnaniError as e:
            return _tts_error(e)

    return FileResponse(
        path,
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=86400", "X-Clip-Cached": "1" if cached else "0"},
    )
