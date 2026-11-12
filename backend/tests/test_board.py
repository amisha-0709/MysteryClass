"""Evidence board: contradiction checks, wrong-link costs, hints, and the player's timeline."""

import pytest

from app.engine import board as rules

from .test_no_leaks import assert_no_leak


@pytest.fixture
def sid(client):
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    client.post(f"/api/sessions/{s}/briefing-complete")
    return s


def link(client, sid, claim, evidence):
    return client.post(f"/api/sessions/{sid}/board/links", json={"claim_id": claim, "evidence_id": evidence})


def hint(client, sid):
    return client.post(f"/api/sessions/{sid}/board/hint").json()


# ── engine ──


def test_match_contradiction_accepts_any_listed_evidence(case001):
    assert rules.match_contradiction(case001, "kabir_c2", "E7").id == "C3"
    assert rules.match_contradiction(case001, "kabir_c2", "E8").id == "C3"
    assert rules.match_contradiction(case001, "kabir_c2", "E4") is None
    assert rules.match_contradiction(case001, "kabir_c1", "E4").id == "C2"


def test_wrong_link_penalty_is_free_then_capped():
    assert [rules.wrong_link_penalty(n) for n in (0, 5, 6, 9, 10, 40)] == [0, 0, 1, 4, 5, 5]


def test_hints_follow_progress(case001):
    first = rules.next_hint(case001, set(), {"E1"}, set())
    assert first.id == "H1"
    assert rules.next_hint(case001, set(), {"E5"}, set()).id == "H2"
    everything = {c.id for c in case001.contradictions}, {e.id for e in case001.evidence}, set()
    assert rules.next_hint(case001, *everything).id == "H8"  # the last hint is always available


# ── API ──


def test_a_true_contradiction_is_confirmed_once(client, sid):
    r = link(client, sid, "kabir_c1", "E4").json()
    assert r["result"] == "contradiction"
    assert r["contradiction"]["id"] == "C2" and "8:16" in r["contradiction"]["explanation"]
    assert r["board"]["wrong_attempts"] == 0
    again = link(client, sid, "kabir_c1", "E4").json()
    assert again["result"] == "already_found" and len(again["board"]["found"]) == 1


def test_contradiction_fires_its_unlock(client, sid):
    r = link(client, sid, "riya_c1", "E1").json()  # C1 unlocks the book, which cascades to its issue record
    assert r["result"] == "contradiction"
    assert [e["id"] for e in r["new_evidence"]] == ["E7", "E8"]
    assert r["new_evidence"][0]["source"] == "Exposed by a contradiction"
    r = link(client, sid, "mehta_c3", "E2").json()  # C5 unlocks the key board
    assert [e["id"] for e in r["new_evidence"]] == ["E5"]
    second = link(client, sid, "mehta_c3", "E5").json()  # other supporting evidence: no double count
    assert second["result"] == "already_found" and len(second["board"]["found"]) == 2


def test_wrong_links_are_counted_once_per_pair(client, sid):
    r = link(client, sid, "mehta_c1", "E4").json()
    assert r["result"] == "no_contradiction" and r["contradiction"] is None
    assert r["board"]["wrong_attempts"] == 1
    again = link(client, sid, "mehta_c1", "E4").json()
    assert again["result"] == "already_tried" and again["board"]["wrong_attempts"] == 1
    assert ["mehta_c1", "E4"] in again["board"]["tried"]


def test_link_validation(client, sid):
    assert link(client, sid, "nobody_c1", "E4").status_code == 404
    r = link(client, sid, "kabir_c2", "E8")  # not found yet
    assert r.status_code == 400 and "haven't found" in r.json()["detail"]
    assert link(client, "nope", "kabir_c1", "E4").status_code == 404


def test_link_needs_briefing(client):
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    assert link(client, s, "kabir_c1", "E4").status_code == 409


def test_hints_charge_once_and_stop_at_the_limit(client, sid):
    h1 = hint(client, sid)
    assert h1["charged"] is True and "two keys" in h1["hint"]
    again = hint(client, sid)
    assert again["charged"] is False and again["hint"] == h1["hint"]  # same advice, no new cost
    assert again["board"]["hints"] == [h1["hint"]]
    state = client.get(f"/api/sessions/{sid}").json()
    assert state["board"]["rules"] == {"free_wrong_links": 5, "wrong_link_cap": 5, "hint_cost": 3, "hint_limit": 5}

    # Progress moves the hint on: getting the key board answers H1.
    client.post(f"/api/sessions/{sid}/suspects/ramesh/ask", json={"question": "Where are the spare keys kept?"})
    assert hint(client, sid)["hint"].startswith("A 'whole morning' alibi")

    for claim, ev in [("kabir_c1", "E4"), ("riya_c1", "E1")]:
        link(client, sid, claim, ev)
    taken = [hint(client, sid) for _ in range(6)]
    charged = sum(h["charged"] for h in taken)
    assert h1["charged"] + 1 + charged <= rules.HINT_LIMIT
    assert len(taken[-1]["board"]["hints"]) <= rules.HINT_LIMIT


def test_hint_limit_returns_none(client, sid):
    from app.db import get_db
    from app.main import app
    from app.models import CaseSession

    db = next(app.dependency_overrides[get_db]())
    cs = db.get(CaseSession, sid)
    cs.hints_used = rules.HINT_LIMIT
    db.add(cs)
    db.commit()
    r = hint(client, sid)
    assert r["hint"] is None and r["charged"] is False


def test_timeline_entries_sort_by_time(client, sid):
    base = f"/api/sessions/{sid}/board/timeline"
    a = client.post(base, json={"time": "08:33", "text": "Kabir back in library", "evidence_id": "E4"})
    b = client.post(base, json={"time": "08:16", "text": "Kabir leaves library"})
    assert a.status_code == b.status_code == 201
    assert client.post(base, json={"time": "8:16", "text": "bad time"}).status_code == 422
    assert client.post(base, json={"time": "08:20", "text": "x", "evidence_id": "E8"}).status_code == 400
    times = [t["time"] for t in client.get(f"/api/sessions/{sid}").json()["board"]["my_timeline"]]
    assert times == ["08:16", "08:33"]
    assert client.delete(f"{base}/{b.json()['id']}").status_code == 204
    assert client.delete(f"{base}/{b.json()['id']}").status_code == 404


def test_board_never_leaks(client, sid, case001):
    state = client.get(f"/api/sessions/{sid}").json()
    unlocked = {e["id"] for e in state["evidence"]}
    wrong = link(client, sid, "mehta_c1", "E4").json()
    assert_no_leak(wrong, case001, unlocked)
    right = link(client, sid, "kabir_c1", "E4").json()
    assert_no_leak(right, case001, unlocked, proven={"C2"})
    h = hint(client, sid)
    assert_no_leak(h, case001, unlocked, proven={"C2"}, hinted={h["hint"]})
    assert "decisive" not in str(right) and "points" not in str(right)
