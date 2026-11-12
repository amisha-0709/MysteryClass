"""Scoring, the final accusation, resolution, XP and achievements."""

import httpx
import pytest

from app.engine import scoring
from app.engine.scoring import Investigation
from app.main import app
from app.voice.gnani_client import GnaniClient
from app.voice.tts import TtsService, get_tts

from .test_voice_stt import Recorder
from .test_voice_tts import audio_ok

GOOD_EXPLANATION = (
    "Kabir left the library at 8:16 while Ramesh was at the canteen and the cabin was unattended. "
    "He took the spare key from the key board, opened F-301 and locked the door again so there was no "
    "forced entry. He photographed the paper on his phone in the washroom and dropped his library book "
    "on the stairs on the way down."
)
ALL_REVEALS = {
    "mehta.spare_key", "mehta.paper_location", "riya.arrival_time", "riya.what_she_saw", "kabir.whereabouts",
    "kabir.upstairs", "kabir.library_book", "kabir.keys", "ramesh.tea_break", "ramesh.keys",
}


def inv(**kw) -> Investigation:
    base = dict(
        accused="kabir",
        explanation=GOOD_EXPLANATION,
        selected_evidence=["E4", "E5", "E6", "E8"],
        proven={"C1", "C2", "C3", "C4", "C5"},
        wrong_links=0,
        hints_used=0,
        revealed=set(ALL_REVEALS),
        evidence_found={f"E{i}" for i in range(1, 11)},
    )
    base.update(kw)
    return Investigation(**base)


def pts(report, cid):
    return next(c.points for c in report.components if c.id == cid)


# ── scoring engine ──


def test_revealable_topics_match_the_script(case001):
    assert scoring.revealable_topics(case001) == ALL_REVEALS


def test_perfect_investigation_scores_100(case001):
    r = scoring.score(case001, inv())
    assert r.total == 100 and r.solved
    assert {c.id: c.points for c in r.components} == {
        "culprit": 25, "evidence": 20, "contradictions": 25, "explanation": 15, "questioning": 15, "hints": 0,
    }
    assert all(c.percent == 100 for c in r.categories)
    assert scoring.xp_for(r) == 200


def test_right_culprit_without_proof_is_a_guess(case001):
    r = scoring.score(case001, inv(selected_evidence=["E1"]))
    assert pts(r, "culprit") == 10 and pts(r, "evidence") == 0  # E1 is a red herring: 0 − 2, floored


def test_wrong_culprit(case001):
    r = scoring.score(case001, inv(accused="riya"))
    assert not r.solved and pts(r, "culprit") == 0
    assert pts(r, "explanation") == 7  # 15 halved, rounded down
    assert "The culprit was Kabir Malhotra" in r.components[0].notes[0]
    assert scoring.xp_for(r) == r.total


def test_evidence_groups_and_penalties(case001):
    assert pts(scoring.score(case001, inv(selected_evidence=["E4", "E7"])), "evidence") == 10  # E7 covers E8
    assert pts(scoring.score(case001, inv(selected_evidence=["E4", "E2", "E3"])), "evidence") == 5  # supporting: free
    assert pts(scoring.score(case001, inv(selected_evidence=["E4", "E9", "E10"])), "evidence") == 1  # 5 − 2 − 2


def test_contradictions_hints_and_wrong_links(case001):
    r = scoring.score(case001, inv(proven={"C1", "C2"}, wrong_links=8, hints_used=2))
    assert pts(r, "contradictions") == 5  # C2 8 + C1 0 − (8 − 5)
    assert pts(r, "hints") == -6
    assert any("Missed: C3, C4, C5" in n for n in r.components[2].notes)


def test_explanation_concepts(case001):
    assert scoring.concepts_covered(case001, GOOD_EXPLANATION) == [
        "spare_key", "guard_away", "left_library", "relocked", "photographed", "book",
    ]
    assert scoring.concepts_covered(case001, "It was Kabir.") == []
    assert "left_library" in scoring.concepts_covered(case001, "he swiped out at 8.16")


def test_questioning_scales(case001):
    r = scoring.score(case001, inv(revealed={"kabir.whereabouts", "ramesh.keys", "not.a_topic"}))
    assert pts(r, "questioning") == 3  # 2 of 10 → 3


# ── API ──


@pytest.fixture
def sid(client):
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    client.post(f"/api/sessions/{s}/briefing-complete")
    return s


def accuse(client, sid, **kw):
    body = {"suspect_id": "kabir", "explanation": GOOD_EXPLANATION, "evidence_ids": ["E4"], **kw}
    return client.post(f"/api/sessions/{sid}/accuse", json=body)


def solve_everything(client, sid):
    """Drive a full investigation through the API only."""
    ask = lambda s, q="", e=None: client.post(  # noqa: E731
        f"/api/sessions/{sid}/suspects/{s}/ask", json={"question": q, **({"evidence_id": e} if e else {})}
    )
    ask("ramesh", "Where are the spare keys kept?")
    ask("ramesh", "", "E5")
    ask("ramesh", "", "E6")
    ask("riya", "", "E1")
    ask("riya", "Did you see anything on the stairs?")
    ask("mehta", "", "E2")
    ask("mehta", "Where did you keep the envelope?")
    ask("mehta", "Where did you keep the envelope?")
    for e in ("E4", "E8", "E5"):
        ask("kabir", "", e)
    ask("kabir", "", "E7")  # upstairs admission
    for claim, ev in [("riya_c1", "E1"), ("kabir_c1", "E4"), ("kabir_c2", "E8"), ("ramesh_c1", "E6"), ("mehta_c3", "E2")]:
        assert client.post(f"/api/sessions/{sid}/board/links", json={"claim_id": claim, "evidence_id": ev}).json()["result"] == "contradiction"


def test_resolution_is_locked_until_accusation(client, sid):
    r = client.get(f"/api/sessions/{sid}/resolution")
    assert r.status_code == 409 and "Kabir" not in r.text
    assert client.get(f"/api/voice/sessions/{sid}/clips/resolution").status_code == 404


def test_accusation_validation(client, sid):
    assert accuse(client, sid, suspect_id="nobody").status_code == 404
    assert accuse(client, sid, evidence_ids=["E8"]).status_code == 400  # not found yet
    assert accuse(client, sid, contradiction_id="C2").status_code == 400  # not proven yet
    assert accuse(client, sid, explanation="   ").status_code == 422
    s2 = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    assert s2 == sid


def test_accusation_needs_briefing(client):
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    assert accuse(client, s).status_code == 409


def test_perfect_run_through_the_api(client, sid):
    solve_everything(client, sid)
    r = accuse(client, sid, evidence_ids=["E4", "E5", "E6", "E8"], contradiction_id="C2", mode="voice")
    assert r.status_code == 200
    res = r.json()
    assert res["correct"] and res["culprit_name"] == "Kabir Malhotra"
    assert res["score"]["total"] == 100
    assert res["xp_earned"] == res["xp_awarded"] == 200
    assert (res["rank_before"], res["rank_after"]) == ("Rookie", "Junior Detective")
    assert {a["code"] for a in res["new_achievements"]} == {
        "case_closed", "unmasked", "airtight", "full_file", "unassisted", "clean_board", "master",
    }
    assert all(c["found"] for c in res["contradictions"])
    assert res["accusation"]["mode"] == "voice" and res["accusation"]["contradiction"] == "C2"
    assert len(res["timeline"]) == 24 and res["timeline"][0]["time"] == "07:50"

    # the case is closed everywhere
    assert client.get(f"/api/sessions/{sid}").json()["progress"]["status"] == "closed"
    assert accuse(client, sid).status_code == 409
    assert client.post(f"/api/sessions/{sid}/suspects/kabir/ask", json={"question": "hi"}).status_code == 409
    assert client.post(f"/api/sessions/{sid}/board/hint").status_code == 409
    assert client.get(f"/api/sessions/{sid}/resolution").json()["score"]["total"] == 100

    me = client.get("/api/player/me").json()
    assert me["xp"] == 200 and me["rank"]["name"] == "Junior Detective" and me["cases_closed"] == 1
    assert sum(a["unlocked_at"] is not None for a in me["achievements"]) == 7
    cases = client.get("/api/cases").json()
    assert cases[0]["status"] == "closed" and cases[0]["session_id"] == sid


def test_replay_only_awards_the_improvement(client, sid):
    first = accuse(client, sid, suspect_id="riya").json()
    assert not first["correct"] and first["xp_awarded"] == first["xp_earned"]
    assert {a["code"] for a in first["new_achievements"]} == {"case_closed"}

    s2 = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    assert s2 != sid  # a fresh investigation
    client.post(f"/api/sessions/{s2}/briefing-complete")
    second = accuse(client, s2).json()
    assert second["correct"]
    assert second["xp_awarded"] == second["xp_earned"] - first["xp_earned"]
    assert "case_closed" not in {a["code"] for a in second["new_achievements"]}
    worse = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    client.post(f"/api/sessions/{worse}/briefing-complete")
    assert accuse(client, worse, suspect_id="mehta").json()["xp_awarded"] == 0
    assert client.get("/api/player/me").json()["xp"] == second["xp_earned"]
    hist = client.get("/api/player/history").json()
    assert [h["session_id"] for h in hist] == [worse, s2, sid]  # newest first, replays kept
    assert [h["solved"] for h in hist] == [False, True, False]


def test_resolution_audio_after_close(client, sid, tmp_path):
    rec = Recorder(audio_ok())
    app.dependency_overrides[get_tts] = lambda: TtsService(
        GnaniClient("k", "https://gnani.test", backoff_s=(0, 0), transport=httpx.MockTransport(rec)), tmp_path
    )
    accuse(client, sid)
    assert client.get(f"/api/voice/sessions/{sid}/clips/resolution").status_code == 200
    assert b"Kabir Malhotra, on academic probation" in rec.requests[0].content
