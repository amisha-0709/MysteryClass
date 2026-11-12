def test_health_reports_flags_not_secrets(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert set(body["integrations"]) == {"gnani", "llm"}
    assert all(isinstance(v, bool) for v in body["integrations"].values())


def test_cases_lists_case_001_with_status(client):
    cases = client.get("/api/cases").json()
    assert cases[0]["id"] == "case_001"
    assert cases[0]["status"] == "new"
    assert cases[0]["session_id"] is None


def test_player_profile_created_and_renamed(client):
    me = client.get("/api/player/me").json()
    assert me["display_name"] == "Detective"
    assert me["rank"]["name"] == "Rookie"
    assert me["rank"]["next_name"] == "Junior Detective"
    me = client.patch("/api/player/me", json={"display_name": "  Sherlock "}).json()
    assert me["display_name"] == "Sherlock"
    assert client.patch("/api/player/me", json={"display_name": ""}).status_code == 422
