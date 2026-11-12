from app.engine.unlocks import initial_evidence


def start(client):
    res = client.post("/api/sessions", json={"case_id": "case_001"})
    assert res.status_code == 200
    return res.json()


def test_start_seeds_initial_evidence_only(client, case001):
    state = start(client)
    got = [e["id"] for e in state["evidence"]]
    assert set(got) == set(initial_evidence(case001))
    assert state["progress"] == {
        "briefing_done": False,
        "status": "active",
        "evidence_found": len(got),
        "evidence_total": len(case001.evidence),
    }
    assert all(e["source"] == "Initial case file" for e in state["evidence"])


def test_start_twice_resumes_same_session(client):
    a, b = start(client), start(client)
    assert a["id"] == b["id"]
    cases = client.get("/api/cases").json()
    assert cases[0]["status"] == "active" and cases[0]["session_id"] == a["id"]
    assert client.get("/api/player/me").json()["cases_active"] == 1


def test_unknown_case_and_session_404(client):
    assert client.post("/api/sessions", json={"case_id": "case_999"}).status_code == 404
    assert client.get("/api/sessions/deadbeef").status_code == 404


def test_briefing_complete_persists(client):
    sid = start(client)["id"]
    assert client.post(f"/api/sessions/{sid}/briefing-complete").json()["progress"]["briefing_done"] is True
    assert client.get(f"/api/sessions/{sid}").json()["progress"]["briefing_done"] is True


def test_notes_crud_and_validation(client):
    sid = start(client)["id"]
    note = client.post(f"/api/sessions/{sid}/notes", json={"text": "  Kabir 8:16?  "}).json()
    assert note["text"] == "Kabir 8:16?"
    assert client.post(f"/api/sessions/{sid}/notes", json={"text": ""}).status_code == 422
    assert [n["text"] for n in client.get(f"/api/sessions/{sid}").json()["notes"]] == ["Kabir 8:16?"]
    assert client.delete(f"/api/sessions/{sid}/notes/{note['id']}").status_code == 204
    assert client.delete(f"/api/sessions/{sid}/notes/{note['id']}").status_code == 404
    assert client.get(f"/api/sessions/{sid}").json()["notes"] == []
