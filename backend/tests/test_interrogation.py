"""Interrogation engine + API: routing, stance changes, unlocks, and that the case is solvable by talking."""

import json

import httpx
import pytest

from app.engine import interrogation as engine
from app.engine.interrogation import Memory, normalize
from app.main import app
from app.voice.gnani_client import GnaniClient
from app.voice.tts import TtsService, get_tts

from .test_no_leaks import assert_no_leak
from .test_voice_stt import Recorder
from .test_voice_tts import audio_ok

# ── routing: natural questions (typed or as Prisma transcribes them) → topic ──

ROUTES = [
    ("mehta", "Who else has a key to F-301?", "spare_key"),
    ("mehta", "is there a spare key", "spare_key"),
    ("mehta", "Where exactly did you keep the envelope?", "paper_location"),
    ("mehta", "Where were you between 8:15 and 8:40?", "exam_cell"),
    ("mehta", "Tell me about your argument with Riya.", "riya_dispute"),
    ("mehta", "What do you know about Kabir?", "kabir"),
    ("riya", "What time did you arrive this morning?", "arrival_time"),
    ("riya", "Did you see anything on the stairs?", "what_she_saw"),
    ("riya", "Did you go inside the faculty room?", "door"),
    ("riya", "Why did you argue with Professor Mehta?", "mehta_dispute"),
    ("kabir", "Where were you at 8.16?", "whereabouts"),
    ("kabir", "Did you leave the library at any point?", "whereabouts"),
    ("kabir", "What did you eat at the canteen?", "canteen"),
    ("kabir", "Did you go up to the third floor?", "upstairs"),
    ("kabir", "Where is your library book?", "library_book"),
    ("kabir", "Do you know where the spare keys are kept?", "keys"),
    ("kabir", "Did you steal the paper?", "confession"),
    ("kabir", "Did you take photos of it on your phone?", "confession"),
    ("ramesh", "Did you leave your post this morning?", "tea_break"),
    ("ramesh", "Were you at the canteen at 8:14?", "tea_break"),
    ("ramesh", "Where are the spare keys kept?", "keys"),
    ("ramesh", "Did Riya go upstairs?", "riya"),
    ("ramesh", "Is the register accurate?", "register"),
    ("ramesh", "Tell me about Kabir.", "kabir"),
]


@pytest.mark.parametrize("suspect_id,question,topic", ROUTES)
def test_questions_route_to_the_right_topic(case001, suspect_id, question, topic):
    kind, ref = engine.route(case001.suspect(suspect_id), question, Memory(), None)
    assert (kind, ref) == ("topic", topic), f"{question!r} → {kind}:{ref}"


@pytest.mark.parametrize(
    "question,line",
    [("Hello there", "greeting"), ("Tell me what happened.", "story"), ("Who do you think did it?", "suspicion"),
     ("What's your favourite colour?", "unknown")],
)
def test_general_questions(case001, question, line):
    assert engine.route(case001.suspect("riya"), question, Memory(), None) == ("line", line)


def test_follow_up_goes_back_to_the_last_topic(case001):
    s = case001.suspect("kabir")
    assert engine.route(s, "Are you sure?", Memory(last_topic="whereabouts"), None) == ("topic", "whereabouts")
    assert engine.route(s, "Why?", Memory(), None) == ("line", "unknown")  # nothing to follow up


def test_normalize_handles_transcripts():
    assert normalize("Where were you at 8.16, near F 301?") == "where were you at 8:16 near f-301"
    assert normalize("Kabir’s book") == "kabir's book"


def test_unrelated_evidence_gets_the_no_link_line(case001):
    a = engine.answer(case001, case001.suspect("mehta"), "", Memory(found={"E4"}), showing="E4")
    assert a.response_id == "mehta.line.no_link"


# ── stance: deny → press → admit only with proof ──


def test_suspect_holds_story_until_shown_proof(case001):
    s = case001.suspect("kabir")
    q = "Were you in the library the whole time?"
    assert engine.answer(case001, s, q, Memory()).response_id == "kabir.whereabouts.deny"
    pressed = Memory()
    pressed.asked["whereabouts"] = 5  # pressing alone never cracks him
    assert engine.answer(case001, s, q, pressed).response_id == "kabir.whereabouts.press"
    shown = engine.answer(case001, s, "", Memory(found={"E4"}), showing="E4")
    assert shown.response_id == "kabir.whereabouts.admit"
    assert shown.reveals == ["kabir.whereabouts"]
    # the admission sticks on later questions
    later = engine.answer(case001, s, q, Memory(presented={"E4"}))
    assert later.response_id == "kabir.whereabouts.admit"


def test_reaction_lines_only_fire_while_showing(case001):
    s = case001.suspect("kabir")
    shown = engine.answer(case001, s, "", Memory(found={"E3"}), showing="E3")
    assert shown.response_id == "kabir.upstairs.envelope_denied"
    later = engine.answer(case001, s, "Did you go upstairs?", Memory(presented={"E3"}))
    assert later.response_id == "kabir.upstairs.deny"


def test_unknown_lines_rotate(case001):
    s = case001.suspect("riya")
    ids = {engine.answer(case001, s, "Do you like cricket?", Memory(unknown_count=i)).response_id for i in range(3)}
    assert len(ids) == 3


def test_every_response_id_resolves(case001):
    for rid, _suspect, text in engine.all_response_ids(case001):
        assert engine.reply_text(case001, rid)[1] == text
    assert engine.reply_text(case001, "kabir.nope.deny") is None
    assert engine.reply_text(case001, "nobody.line.greeting") is None


# ── API ──


@pytest.fixture
def sid(client):
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    client.post(f"/api/sessions/{s}/briefing-complete")
    return s


def ask(client, sid, suspect, question="", evidence=None, mode="text"):
    body = {"question": question, "mode": mode}
    if evidence:
        body["evidence_id"] = evidence
    return client.post(f"/api/sessions/{sid}/suspects/{suspect}/ask", json=body)


def test_ask_requires_briefing_known_suspect_and_found_evidence(client):
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    assert ask(client, s, "riya", "hi").status_code == 409
    client.post(f"/api/sessions/{s}/briefing-complete")
    assert ask(client, s, "nobody", "hi").status_code == 404
    assert ask(client, s, "riya", "   ").status_code == 422
    r = ask(client, s, "riya", "", evidence="E7")  # locked
    assert r.status_code == 400 and "haven't found" in r.json()["detail"]


def test_ask_returns_only_the_chosen_reply(client, sid, case001):
    r = ask(client, sid, "riya", "What time did you arrive?", mode="voice")
    assert r.status_code == 200
    body = r.json()
    t = body["turn"]
    assert t["reply"].startswith("Eight-twenty") and t["mode"] == "voice"
    assert t["clip_id"] == "reply.riya.arrival_time.deny" and t["revealed"] is False
    blob = json.dumps(body)
    for key in ('"topic_id"', '"when"', '"keywords"', '"reveals"', '"label"', '"lines"'):
        assert key not in blob
    other_replies = [text for rid, _, text in engine.all_response_ids(case001) if rid != "riya.arrival_time.deny"]
    assert not [x for x in other_replies if x in blob]


def test_confronting_with_proof_unlocks_evidence_and_is_recorded(client, sid):
    r = ask(client, sid, "riya", "", evidence="E1").json()
    assert r["turn"]["revealed"] is True and "Eight-thirty-five" in r["turn"]["reply"]
    assert [e["id"] for e in r["new_evidence"]] == ["E7", "E8"]  # book, then the cascade to its issue record
    assert r["new_evidence"][0]["source"] == "Revealed under confrontation"
    again = ask(client, sid, "riya", "When did you arrive?").json()
    assert again["turn"]["revealed"] is False and again["new_evidence"] == []
    turns = client.get(f"/api/sessions/{sid}/turns", params={"suspect_id": "riya"}).json()
    assert [t["evidence_title"] for t in turns] == ["Lobby Security Register", None]


def test_the_case_can_be_cracked_by_interrogation_alone(client, sid, case001):
    """Every locked item is reachable through talking, in a natural order."""
    have = lambda: {e["id"] for e in client.get(f"/api/sessions/{sid}").json()["evidence"]}  # noqa: E731
    assert "E5" not in have()
    assert "spare" in ask(client, sid, "ramesh", "Where are the spare keys kept?").json()["turn"]["reply"]
    assert "E5" in have()
    r = ask(client, sid, "ramesh", "", evidence="E5").json()
    assert "wrong hook" in r["turn"]["reply"].lower() and [e["id"] for e in r["new_evidence"]] == ["E6"]
    assert "chai" in ask(client, sid, "ramesh", "", evidence="E6").json()["turn"]["reply"]
    assert "no student" in ask(client, sid, "ramesh", "What about Kabir?").json()["turn"]["reply"]
    ask(client, sid, "riya", "", evidence="E1")
    assert have() == {e.id for e in case001.evidence}

    # Kabir cracks step by step, but never confesses: the culprit is only confirmed at the accusation.
    ask(client, sid, "kabir", "", evidence="E4")
    assert "my book" in ask(client, sid, "kabir", "", evidence="E8").json()["turn"]["reply"]
    assert "washroom" in ask(client, sid, "kabir", "", evidence="E7").json()["turn"]["reply"]
    ask(client, sid, "kabir", "", evidence="E5")
    final = ask(client, sid, "kabir", "Did you steal the paper?").json()["turn"]
    assert final["clip_id"] == "reply.kabir.confession.breaks"
    assert "took" not in final["reply"].lower() and "photograph" not in final["reply"].lower()


def test_closed_session_rejects_questions(client, sid):
    from app.db import get_db
    from app.models import CaseSession

    db = next(app.dependency_overrides[get_db]())
    cs = db.get(CaseSession, sid)
    cs.status = "closed"
    db.add(cs)
    db.commit()
    assert ask(client, sid, "riya", "hi").status_code == 409


def test_reply_audio_is_served_only_after_the_reply_was_given(client, sid, tmp_path):
    rec = Recorder(audio_ok())
    app.dependency_overrides[get_tts] = lambda: TtsService(
        GnaniClient("k", "https://gnani.test", backoff_s=(0, 0), transport=httpx.MockTransport(rec)), tmp_path
    )
    url = f"/api/voice/sessions/{sid}/clips/reply.kabir.confession.breaks"
    assert client.get(url).status_code == 404  # not heard yet: no reading ahead through audio
    clip = ask(client, sid, "kabir", "Hello").json()["turn"]["clip_id"]
    r = client.get(f"/api/voice/sessions/{sid}/clips/{clip}")
    assert r.status_code == 200 and r.content[:4] == b"RIFF"
    assert json.loads(rec.requests[0].content)["voice"] == "Shlok"
    assert len(rec.requests) == 1


def test_no_leaks_before_and_during_interrogation(client, sid, case001):
    state = client.get(f"/api/sessions/{sid}").json()
    unlocked = {e["id"] for e in state["evidence"]}
    assert_no_leak(state, case001, unlocked)
    r = ask(client, sid, "mehta", "Who else has a key?").json()
    heard = {r["turn"]["reply"]}
    assert_no_leak(r, case001, unlocked, heard=heard)
    assert_no_leak(client.get(f"/api/sessions/{sid}/turns").json(), case001, unlocked, heard=heard)


def test_session_state_counts_questions_and_slips_per_suspect(client, sid):
    ask(client, sid, "kabir", "Were you in the library?")
    ask(client, sid, "kabir", "", evidence="E4")
    summary = client.get(f"/api/sessions/{sid}").json()["interrogation"]
    assert summary["kabir"] == {"asked": 2, "slips": 1}
    assert summary["riya"] == {"asked": 0, "slips": 0}
