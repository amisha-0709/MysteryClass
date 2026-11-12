"""Full case definition schema (server-side only).

Everything in a case file is loaded into these models. Fields are split into two kinds:
  * public: may be shown to the player (only through engine/public_view.py)
  * hidden: truth, secrets, unlock rules, contradictions, solution. Never serialized pre-resolution.

Unlock trigger grammar (used in Evidence.unlock.triggers):
  contradiction:<contradiction_id>       player linked a claim to evidence correctly
  reveal:<suspect_id>.<topic_id>         suspect admitted/revealed something in interrogation
  confront:<suspect_id>:<evidence_id>    player presented that evidence to that suspect
  evidence:<evidence_id>                 another evidence item was unlocked (cascade)
"""

from typing import Literal

from pydantic import BaseModel, Field


class Strict(BaseModel):
    model_config = {"extra": "forbid"}


# ── public-facing building blocks ───────────────────────────────────────────


class CaseMeta(Strict):
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


class Briefing(Strict):
    incident: str
    location: str
    date: str
    time_of_incident: str
    objective: str
    situation: list[str]
    narration: str  # narrator script, spoken by the narrator voice


class VoiceConfig(Strict):  # hidden (not secret, just not needed client-side)
    model: str = "timbre-v2.5"
    voice: str
    language: str = "en-IN"
    speed: float = 1.0


class Avatar(Strict):
    initials: str
    accent: str  # hex colour used for the portrait rim light
    style: Literal["glasses", "long_hair", "short_hair", "cap"] = "short_hair"  # silhouette variant


class Claim(Strict):
    """One atomic, checkable claim from a statement. Pinned on the evidence board."""

    id: str
    text: str


class Reply(Strict):
    """One authored answer. The engine picks the LAST reply in a topic whose conditions all hold.

    Conditions (all-of; `|` inside one condition means any-of):
      presented:E4        the player has shown E4 to THIS suspect (now or earlier): for admissions that stick
      presented:E7|E8     ... either of them
      showing:E3          E3 is being shown on THIS turn: for one-off reactions to the item
      found:E5            the player has unlocked E5
      revealed:riya.arrival_time   that suspect has already let that topic slip
      asked:1             this topic has been asked about at least once before (pressing)
    """

    id: str
    text: str
    when: list[str] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)  # topic ids of this suspect → fires reveal:<suspect>.<topic>


class Topic(Strict):
    """Interrogation topic (hidden). Matched from the player's words, or by presenting linked evidence."""

    id: str
    label: str
    keywords: list[str] = Field(default_factory=list)  # lowercase phrases; plural "s" matches automatically
    evidence: list[str] = Field(default_factory=list)  # presenting one of these routes here
    replies: list[Reply] = Field(min_length=1)


class SuspectLines(Strict):
    """Stock answers for general questions and anything the suspect has no topic for."""

    greeting: str
    story: str
    suspicion: str
    no_link: str  # evidence that has nothing to do with them
    unknown: list[str] = Field(min_length=2)  # rotated


class Suspect(Strict):
    id: str
    name: str
    role: str
    age: int
    avatar: Avatar
    personality: str
    background: str
    statement: str  # full initial statement (transcript + TTS source)
    claims: list[Claim]
    # hidden
    voice: VoiceConfig
    truth: str
    secrets: list[str]
    topics: list[Topic] = Field(default_factory=list)  # merged from dialogue.json
    lines: SuspectLines | None = None  # merged from dialogue.json


class UnlockRule(Strict):
    initial: bool = False
    triggers: list[str] = Field(default_factory=list)  # any-of


class Evidence(Strict):
    id: str
    title: str
    kind: Literal["document", "log", "object", "record", "report", "receipt"]
    summary: str
    details: list[str]
    found_at: str
    # hidden
    tier: int
    unlock: UnlockRule
    relevance: str


# ── hidden: reasoning layer ───────────────────────────────────────────────


class Contradiction(Strict):
    id: str
    claim_id: str
    evidence_ids: list[str]  # linking the claim to ANY of these counts
    explanation: str
    decisive: bool
    points: int


class TimelineEvent(Strict):
    time: str  # "HH:MM", 24h
    text: str
    evidence_ids: list[str] = Field(default_factory=list)


class RubricConcept(Strict):
    id: str
    label: str
    keywords: list[str]


class Solution(Strict):
    culprit_id: str
    summary: str
    motive: str
    method: list[str]
    decisive_evidence: list[str]
    supporting_evidence: list[str] = Field(default_factory=list)  # relevant but not scored; no penalty
    decisive_contradictions: list[str]
    innocents: dict[str, str]
    rubric: list[RubricConcept]


class Hint(Strict):
    """Progressive hint (hidden). The server gives the first hint that isn't done yet.

    done_when is any-of: contradiction:<id> | found:<evidence_id> | revealed:<suspect>.<topic>.
    The last hint should have no done_when so there is always something to say.
    """

    id: str
    text: str
    done_when: list[str] = Field(default_factory=list)


class Narrator(Strict):
    voice: VoiceConfig


class SttHints(Strict):
    """Recognition hints sent to Prisma v3.0 (hidden: spoilers could hide in keyterms)."""

    keyterms: list[str] = Field(default_factory=list, max_length=200)
    topic: str = Field(default="", max_length=1600)


class CaseDefinition(Strict):
    meta: CaseMeta
    briefing: Briefing
    narrator: Narrator
    stt: SttHints = Field(default_factory=SttHints)
    suspects: list[Suspect]
    evidence: list[Evidence]
    contradictions: list[Contradiction]
    timeline: list[TimelineEvent]
    hints: list[Hint] = Field(default_factory=list)
    solution: Solution

    # convenience lookups
    def suspect(self, suspect_id: str) -> Suspect | None:
        return next((s for s in self.suspects if s.id == suspect_id), None)

    def evidence_item(self, evidence_id: str) -> Evidence | None:
        return next((e for e in self.evidence if e.id == evidence_id), None)

    def claim(self, claim_id: str) -> tuple[Suspect, Claim] | None:
        for s in self.suspects:
            for c in s.claims:
                if c.id == claim_id:
                    return s, c
        return None
