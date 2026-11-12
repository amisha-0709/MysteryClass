"""Whitelist serializers: the ONLY path from case data to the client.

Each DTO is constructed field-by-field so new hidden fields added to the case schema can
never leak by accident.
"""

from ..models import Note, UnlockedEvidence
from ..schemas.case import CaseDefinition, CaseMeta, Evidence, Suspect
from ..schemas.public import (
    CaseSummary,
    NoteOut,
    PublicAvatar,
    PublicBriefing,
    PublicClaim,
    PublicEvidence,
    PublicSuspect,
)

SOURCE_LABELS = {
    "initial": "Initial case file",
    "contradiction": "Exposed by a contradiction",
    "reveal": "Revealed in interrogation",
    "confront": "Revealed under confrontation",
    "evidence": "Followed up from other evidence",
}


def case_summary(meta: CaseMeta) -> CaseSummary:
    return CaseSummary(
        id=meta.id,
        number=meta.number,
        title=meta.title,
        teaser=meta.teaser,
        location=meta.location,
        incident_time=meta.incident_time,
        difficulty=meta.difficulty,
        suspect_count=meta.suspect_count,
        est_minutes=meta.est_minutes,
        order=meta.order,
    )


def briefing(case: CaseDefinition) -> PublicBriefing:
    b = case.briefing
    return PublicBriefing(
        incident=b.incident,
        location=b.location,
        date=b.date,
        time_of_incident=b.time_of_incident,
        objective=b.objective,
        situation=list(b.situation),
        narration=b.narration,
    )


def suspect(s: Suspect) -> PublicSuspect:
    return PublicSuspect(
        id=s.id,
        name=s.name,
        role=s.role,
        age=s.age,
        avatar=PublicAvatar(initials=s.avatar.initials, accent=s.avatar.accent, style=s.avatar.style),
        personality=s.personality,
        background=s.background,
        statement=s.statement,
        claims=[PublicClaim(id=c.id, text=c.text) for c in s.claims],
    )


def evidence(e: Evidence, row: UnlockedEvidence) -> PublicEvidence:
    return PublicEvidence(
        id=e.id,
        title=e.title,
        kind=e.kind,
        summary=e.summary,
        details=list(e.details),
        found_at=e.found_at,
        unlocked_at=row.unlocked_at,
        source=SOURCE_LABELS.get(row.source.split(":", 1)[0], "Investigation"),
    )


def unlocked_evidence(case: CaseDefinition, rows: list[UnlockedEvidence]) -> list[PublicEvidence]:
    out = []
    for row in sorted(rows, key=lambda r: (r.unlocked_at, r.id or 0)):
        item = case.evidence_item(row.evidence_id)
        if item is not None:
            out.append(evidence(item, row))
    return out


def note(n: Note) -> NoteOut:
    return NoteOut(id=n.id or 0, text=n.text, created_at=n.created_at)
