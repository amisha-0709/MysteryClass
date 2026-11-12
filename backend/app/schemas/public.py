"""Client-facing DTOs. Every field here is safe to show the player at any point before resolution."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CaseSummary(BaseModel):
    id: str
    number: str
    title: str
    teaser: str
    location: str
    incident_time: str
    difficulty: str
    suspect_count: int
    est_minutes: int
    order: int


class CaseListItem(CaseSummary):
    status: str  # "new" | "active" | "closed"
    session_id: str | None = None


class PublicBriefing(BaseModel):
    incident: str
    location: str
    date: str
    time_of_incident: str
    objective: str
    situation: list[str]
    narration: str


class PublicAvatar(BaseModel):
    initials: str
    accent: str
    style: str


class PublicClaim(BaseModel):
    id: str
    text: str


class PublicSuspect(BaseModel):
    id: str
    name: str
    role: str
    age: int
    avatar: PublicAvatar
    personality: str
    background: str
    statement: str
    claims: list[PublicClaim]


class PublicEvidence(BaseModel):
    id: str
    title: str
    kind: str
    summary: str
    details: list[str]
    found_at: str
    unlocked_at: datetime
    source: str  # how the player obtained it, e.g. "Initial case file"


class NoteOut(BaseModel):
    id: int
    text: str
    created_at: datetime


class Progress(BaseModel):
    briefing_done: bool
    status: str
    evidence_found: int
    evidence_total: int


class FoundContradiction(BaseModel):
    id: str
    claim_id: str
    evidence_id: str
    explanation: str  # earned: shown only once the player has found it
    found_at: datetime


class TimelineEntryOut(BaseModel):
    id: int
    time: str
    text: str
    evidence_id: str | None


class BoardRules(BaseModel):
    free_wrong_links: int
    wrong_link_cap: int
    hint_cost: int
    hint_limit: int


class BoardState(BaseModel):
    found: list[FoundContradiction]  # contradictions the player has proven
    wrong_attempts: int
    tried: list[tuple[str, str]]  # (claim_id, evidence_id) pairs already tested
    hints: list[str]  # hint texts already given, in order
    my_timeline: list[TimelineEntryOut]  # the player's own reconstruction
    rules: BoardRules


class SessionState(BaseModel):
    id: str
    case: CaseSummary
    briefing: PublicBriefing
    suspects: list[PublicSuspect]
    evidence: list[PublicEvidence]
    notes: list[NoteOut]
    progress: Progress
    board: BoardState


class RankOut(BaseModel):
    name: str
    xp_floor: int
    next_name: str | None
    next_xp: int | None


class PlayerOut(BaseModel):
    id: int
    display_name: str
    xp: int
    rank: RankOut
    cases_closed: int
    cases_active: int
    achievements: list["AchievementOut"] = Field(default_factory=list)


class PlayerUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=40)


class StartSession(BaseModel):
    case_id: str = Field(min_length=1, max_length=64)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class AskIn(BaseModel):
    question: str = Field(default="", max_length=500)
    mode: Literal["text", "voice"] = "text"
    evidence_id: str | None = Field(default=None, max_length=10)


class TurnOut(BaseModel):
    id: int
    suspect_id: str
    question: str
    mode: str
    evidence_id: str | None
    evidence_title: str | None
    reply: str
    clip_id: str  # GET /api/voice/sessions/{id}/clips/{clip_id} speaks the reply
    revealed: bool
    created_at: datetime


class AskOut(BaseModel):
    turn: TurnOut
    new_evidence: list[PublicEvidence]


class LinkIn(BaseModel):
    claim_id: str = Field(max_length=40)
    evidence_id: str = Field(max_length=10)


class LinkOut(BaseModel):
    result: Literal["contradiction", "no_contradiction", "already_found", "already_tried"]
    contradiction: FoundContradiction | None = None
    new_evidence: list[PublicEvidence] = Field(default_factory=list)
    board: BoardState


class HintOut(BaseModel):
    hint: str | None  # None when the hint limit is used up
    charged: bool
    board: BoardState


class TimelineIn(BaseModel):
    time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    text: str = Field(min_length=1, max_length=200)
    evidence_id: str | None = Field(default=None, max_length=10)


class AchievementOut(BaseModel):
    code: str
    title: str
    description: str
    unlocked_at: datetime | None


class AccuseIn(BaseModel):
    suspect_id: str = Field(max_length=40)
    explanation: str = Field(min_length=1, max_length=4000)
    mode: Literal["text", "voice"] = "text"
    evidence_ids: list[str] = Field(default_factory=list, max_length=10)
    contradiction_id: str | None = Field(default=None, max_length=10)


class ScoreComponentOut(BaseModel):
    id: str
    label: str
    points: int
    max: int
    notes: list[str]


class ScoreCategoryOut(BaseModel):
    id: str
    label: str
    percent: int
    description: str


class ScoreOut(BaseModel):
    total: int
    solved: bool
    components: list[ScoreComponentOut]
    categories: list[ScoreCategoryOut]


class InnocentOut(BaseModel):
    suspect_id: str
    name: str
    explanation: str


class RevealedContradiction(BaseModel):
    id: str
    suspect_name: str
    claim: str
    evidence: list[str]  # "E4 · Library RFID Gate Log"
    explanation: str
    decisive: bool
    points: int
    found: bool


class RevealedEvent(BaseModel):
    time: str
    text: str
    evidence_ids: list[str]
    you_found: bool  # every evidence item behind this event is in the player's file


class YourAccusation(BaseModel):
    suspect_id: str
    suspect_name: str
    explanation: str
    mode: str
    evidence: list[str]
    contradiction: str | None


class ResolutionOut(BaseModel):
    """Only served once the case is closed: this is the answer key."""

    case: CaseSummary
    correct: bool
    culprit_id: str
    culprit_name: str
    summary: str
    motive: str
    method: list[str]
    innocents: list[InnocentOut]
    contradictions: list[RevealedContradiction]
    timeline: list[RevealedEvent]
    accusation: YourAccusation
    score: ScoreOut
    xp_earned: int
    xp_awarded: int
    rank_before: str
    rank_after: str
    new_achievements: list[AchievementOut]
    clip_id: str  # narrator reads the solution summary


PlayerOut.model_rebuild()  # resolves the forward reference to AchievementOut


class HistoryItem(BaseModel):
    session_id: str
    case_id: str
    case_title: str
    case_number: str
    solved: bool
    total: int
    xp_awarded: int
    closed_at: datetime
