from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


class Player(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    display_name: str = "Detective"
    xp: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class CaseSession(SQLModel, table=True):
    # At most one active investigation per player per case (guards against concurrent starts).
    __table_args__ = (
        Index(
            "uq_active_session",
            "player_id",
            "case_id",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
    )

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    player_id: int = Field(foreign_key="player.id", index=True)
    case_id: str = Field(index=True)
    status: str = "active"  # active | closed
    briefing_done: bool = False
    hints_used: int = 0
    started_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    completed_at: datetime | None = None


class UnlockedEvidence(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("session_id", "evidence_id"),)

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", index=True)
    evidence_id: str
    source: str  # trigger that unlocked it, e.g. "initial", "contradiction:C1"
    unlocked_at: datetime = Field(default_factory=utcnow)


class Note(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", index=True)
    text: str
    created_at: datetime = Field(default_factory=utcnow)


class InterrogationTurn(SQLModel, table=True):
    """One question (optionally with evidence shown) and the suspect's authored reply.

    The reply text is not stored: response_id points into the case's dialogue, so history always
    matches the current script. Suspect state (pressing, admissions) is derived from these rows.
    """

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", index=True)
    suspect_id: str = Field(index=True)
    question: str
    mode: str = "text"  # text | voice
    evidence_id: str | None = None
    topic_id: str | None = None
    response_id: str
    revealed: bool = False  # this reply let something slip for the first time
    created_at: datetime = Field(default_factory=utcnow)


class LinkAttempt(SQLModel, table=True):
    """A claim pinned against a piece of evidence on the board. contradiction_id is set when it holds."""

    __table_args__ = (UniqueConstraint("session_id", "claim_id", "evidence_id"),)

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", index=True)
    claim_id: str
    evidence_id: str
    contradiction_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class HintUsed(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("session_id", "hint_id"),)

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", index=True)
    hint_id: str
    created_at: datetime = Field(default_factory=utcnow)


class TimelineEntry(SQLModel, table=True):
    """The player's own reconstruction of the morning (not checked against the truth)."""

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", index=True)
    time: str  # HH:MM
    text: str
    evidence_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class Accusation(SQLModel, table=True):
    """The player's final answer. One per session; making it closes the case."""

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", unique=True)
    suspect_id: str
    explanation: str
    mode: str = "text"  # text | voice
    evidence_ids: str = ""  # comma-separated, in the order chosen
    contradiction_id: str | None = None  # the one the player says gave the culprit away
    created_at: datetime = Field(default_factory=utcnow)


class CaseResult(SQLModel, table=True):
    """Frozen score report, so the resolution page never changes after the fact."""

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="casesession.id", unique=True)
    total: int
    solved: bool
    report_json: str
    xp_earned: int  # what this case is worth
    xp_awarded: int  # what was actually added (replays only add the improvement)
    rank_before: str
    rank_after: str
    new_achievements: str = ""  # comma-separated codes
    created_at: datetime = Field(default_factory=utcnow)


class Achievement(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("player_id", "code"),)

    id: int | None = Field(default=None, primary_key=True)
    player_id: int = Field(foreign_key="player.id", index=True)
    code: str
    session_id: str | None = None
    unlocked_at: datetime = Field(default_factory=utcnow)
