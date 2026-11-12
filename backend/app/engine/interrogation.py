"""Deterministic interrogation engine.

A suspect answers only with lines authored in dialogue.json. The engine decides WHICH line:

1. Route the question to a topic.
   * Presenting evidence routes to the first topic that lists that evidence (else the "no_link" line).
   * Otherwise the words are scored against each topic's keywords (a phrase scores its word count).
     General questions (greeting, "what happened", "who did it") score at half weight, so a specific
     topic always wins a tie.
   * Nothing matched, but it sounds like a follow-up ("why?", "are you sure?") → the last topic again.
   * Still nothing → a rotating "I don't know" line.
2. Pick the reply: the LAST reply in the topic whose conditions all hold (see schemas.case.Reply).
   Conditions only ever unlock with evidence or persistence, so a suspect keeps their story straight
   until the player proves otherwise.

The engine is pure: callers pass in what has happened so far (Memory) and persist the result.
"""

import re
from collections import Counter
from dataclasses import dataclass, field

from ..schemas.case import CaseDefinition, Reply, Suspect, Topic

GENERAL_INTENTS: dict[str, list[str]] = {
    "greeting": ["hello", "hi", "hey", "good morning", "good afternoon", "namaste", "nice to meet you"],
    "story": [
        "what happened", "tell me what happened", "your side", "walk me through", "statement", "from the beginning",
        "your story", "what did you do", "what were you doing", "describe your morning", "this morning",
    ],
    "suspicion": [
        "who do you think", "who did it", "who did this", "who took", "who stole", "suspect", "suspicious",
        "who could have", "anyone suspicious", "your guess", "who would",
    ],
}
GENERAL_WEIGHT = 0.5

FOLLOW_UP_CUES = [
    "why", "really", "are you sure", "sure", "explain", "what else", "and then", "then what", "tell me more",
    "go on", "lying", "liar", "be honest", "honestly", "come on", "how", "what do you mean", "is that true",
    "the truth", "seriously", "anything else",
]

_WORD_SUB = [
    (re.compile(r"[‘’`]"), "'"),
    (re.compile(r"\b(\d{1,2})[.](\d{2})\b"), r"\1:\2"),  # 8.16 → 8:16
    (re.compile(r"\bf\s*-?\s*(\d{3})\b"), r"f-\1"),  # f 301 / f301 → f-301
    (re.compile(r"[^a-z0-9:'\- ]+"), " "),
    (re.compile(r"\s+"), " "),
]


def normalize(text: str) -> str:
    t = text.lower()
    for pat, rep in _WORD_SUB:
        t = pat.sub(rep, t)
    return t.strip()


def _phrase_re(phrase: str) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9'])" + re.escape(phrase) + r"(?:s|es)?(?![a-z0-9])")


_CACHE: dict[str, re.Pattern] = {}


def _has(text: str, phrase: str) -> bool:
    p = _CACHE.get(phrase)
    if p is None:
        p = _CACHE[phrase] = _phrase_re(normalize(phrase))
    return bool(p.search(text))


def score(text: str, keywords: list[str]) -> float:
    return float(sum(len(k.split()) for k in keywords if _has(text, k)))


# ── state passed in by the caller ──────────────────────────────────────


@dataclass
class Memory:
    """What has happened so far in this session, as far as one suspect's answers are concerned."""

    presented: set[str] = field(default_factory=set)  # evidence shown to THIS suspect before now
    asked: Counter = field(default_factory=Counter)  # topic id → times asked before now
    last_topic: str | None = None
    unknown_count: int = 0
    revealed: set[str] = field(default_factory=set)  # "<suspect>.<topic>" across ALL suspects
    found: set[str] = field(default_factory=set)  # unlocked evidence ids


@dataclass
class Answer:
    response_id: str
    text: str
    topic_id: str | None  # None for general/unknown lines
    reveals: list[str]  # "<suspect>.<topic>" fired by this answer


# ── condition evaluation ───────────────────────────────────────────────


def condition_holds(cond: str, suspect_id: str, topic_id: str, mem: Memory, showing: str | None) -> bool:
    kind, _, arg = cond.partition(":")
    options = arg.split("|")
    if kind == "presented":
        return any(o in mem.presented or o == showing for o in options)
    if kind == "showing":
        return showing in options
    if kind == "found":
        return any(o in mem.found for o in options)
    if kind == "revealed":
        return any(o in mem.revealed for o in options)
    if kind == "asked":
        return mem.asked[topic_id] >= int(arg)
    raise ValueError(f"unknown condition {cond!r}")


def pick_reply(suspect: Suspect, topic: Topic, mem: Memory, showing: str | None) -> Reply:
    chosen = topic.replies[0]
    for r in topic.replies:
        if all(condition_holds(c, suspect.id, topic.id, mem, showing) for c in r.when):
            chosen = r
    return chosen


# ── routing ────────────────────────────────────────────────────────────


def route(suspect: Suspect, question: str, mem: Memory, showing: str | None) -> tuple[str, str | None]:
    """Return (kind, id): ("topic", topic_id) | ("line", greeting/story/suspicion/no_link/unknown)."""
    if showing:
        t = next((t for t in suspect.topics if showing in t.evidence), None)
        return ("topic", t.id) if t else ("line", "no_link")

    text = normalize(question)
    best_id, best = None, 0.0
    for t in suspect.topics:
        s = score(text, t.keywords)
        if s > best:
            best_id, best = t.id, s
    best_general, best_general_score = None, 0.0
    for intent, kws in GENERAL_INTENTS.items():
        s = score(text, kws) * GENERAL_WEIGHT
        if s > best_general_score:
            best_general, best_general_score = intent, s

    if best_id and best >= best_general_score:
        return "topic", best_id
    if best_general:
        return "line", best_general
    if mem.last_topic and (len(text.split()) <= 4 or score(text, FOLLOW_UP_CUES) > 0):
        return "topic", mem.last_topic
    return "line", "unknown"


def answer(case: CaseDefinition, suspect: Suspect, question: str, mem: Memory, showing: str | None = None) -> Answer:
    kind, ref = route(suspect, question, mem, showing)
    if kind == "topic":
        topic = next(t for t in suspect.topics if t.id == ref)
        reply = pick_reply(suspect, topic, mem, showing)
        return Answer(
            response_id=f"{suspect.id}.{topic.id}.{reply.id}",
            text=reply.text,
            topic_id=topic.id,
            reveals=[f"{suspect.id}.{t}" for t in reply.reveals],
        )

    lines = suspect.lines
    assert lines is not None, f"{suspect.id} has no dialogue lines"
    if ref == "unknown":
        i = mem.unknown_count % len(lines.unknown)
        return Answer(f"{suspect.id}.line.unknown.{i}", lines.unknown[i], None, [])
    return Answer(f"{suspect.id}.line.{ref}", getattr(lines, ref), None, [])


# ── lookups used for history and audio ─────────────────────────────────


def reply_text(case: CaseDefinition, response_id: str) -> tuple[Suspect, str, list[str]] | None:
    """Resolve a stored response id back to (suspect, text, reveals)."""
    parts = response_id.split(".")
    suspect = case.suspect(parts[0]) if parts else None
    if suspect is None or len(parts) < 3:
        return None
    if parts[1] == "line":
        lines = suspect.lines
        if lines is None:
            return None
        if parts[2] == "unknown" and len(parts) == 4 and parts[3].isdigit():
            i = int(parts[3])
            return (suspect, lines.unknown[i], []) if i < len(lines.unknown) else None
        text = getattr(lines, parts[2], None) if parts[2] in {"greeting", "story", "suspicion", "no_link"} else None
        return (suspect, text, []) if isinstance(text, str) else None
    topic = next((t for t in suspect.topics if t.id == parts[1]), None)
    reply = next((r for r in topic.replies if r.id == parts[2]), None) if topic else None
    if reply is None:
        return None
    return suspect, reply.text, [f"{suspect.id}.{t}" for t in reply.reveals]


def all_response_ids(case: CaseDefinition) -> list[tuple[str, Suspect, str]]:
    """Every line a suspect can ever say: (response_id, suspect, text). Used by the audio pre-generator."""
    out: list[tuple[str, Suspect, str]] = []
    for s in case.suspects:
        if s.lines:
            for k in ("greeting", "story", "suspicion", "no_link"):
                out.append((f"{s.id}.line.{k}", s, getattr(s.lines, k)))
            out += [(f"{s.id}.line.unknown.{i}", s, t) for i, t in enumerate(s.lines.unknown)]
        for t in s.topics:
            out += [(f"{s.id}.{t.id}.{r.id}", s, r.text) for r in t.replies]
    return out
