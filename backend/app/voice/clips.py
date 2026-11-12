"""Which lines can be spoken, and in whose voice.

The browser never sends text to synthesise. It asks for a clip id; the server looks the text up in the
case file. This keeps TTS spend bounded to authored lines and means audio can never carry anything the
player isn't already allowed to read.

Clip ids:
  narration              the briefing narration (narrator voice)
  statement.<suspect>    a suspect's opening statement (their voice)
  reply.<response_id>    an interrogation reply. Served only if THIS session has been given that
                         reply, so audio can't be used to read ahead in the script.
"""

from dataclasses import dataclass

from ..engine.interrogation import all_response_ids, reply_text
from ..schemas.case import CaseDefinition, VoiceConfig


@dataclass(frozen=True)
class ClipSpec:
    id: str
    voice: VoiceConfig
    text: str
    speaker: str


def static_clips(case: CaseDefinition) -> list[ClipSpec]:
    """Every authored line that pregen_audio.py should render ahead of time."""
    clips = [ClipSpec("narration", case.narrator.voice, case.briefing.narration, "Narrator")]
    clips += [ClipSpec(f"statement.{s.id}", s.voice, s.statement, s.name) for s in case.suspects]
    return clips


def reply_clips(case: CaseDefinition) -> list[ClipSpec]:
    """Every interrogation reply (pre-generation only; never resolvable without a session check)."""
    return [ClipSpec(f"reply.{rid}", s.voice, text, s.name) for rid, s, text in all_response_ids(case)]


def resolve_clip(case: CaseDefinition, clip_id: str) -> ClipSpec | None:
    """Public clips only. Replies go through resolve_reply_clip, after the caller checks the session."""
    return next((c for c in static_clips(case) if c.id == clip_id), None)


def resolution_clip(case: CaseDefinition) -> ClipSpec:
    """The solution, read by the narrator. The caller must check the session is closed."""
    return ClipSpec("resolution", case.narrator.voice, case.solution.summary, "Narrator")


def resolve_reply_clip(case: CaseDefinition, clip_id: str) -> ClipSpec | None:
    if not clip_id.startswith("reply."):
        return None
    resolved = reply_text(case, clip_id.removeprefix("reply."))
    if resolved is None:
        return None
    suspect, text, _ = resolved
    return ClipSpec(clip_id, suspect.voice, text, suspect.name)
