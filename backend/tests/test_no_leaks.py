"""The answer key must never reach the client before resolution.

Collects every hidden string in the case definition (truths, secrets, solution, contradiction
explanations, timeline, evidence relevance, locked evidence content, voice config) and asserts
none of it appears in any pre-resolution API response.
"""

import json

from app.engine.interrogation import all_response_ids
from app.schemas.case import CaseDefinition


def hidden_strings(
    case: CaseDefinition,
    unlocked: set[str],
    heard: set[str] = frozenset(),
    proven: set[str] = frozenset(),
    hinted: set[str] = frozenset(),
) -> list[str]:
    """heard: replies given; proven: contradiction ids found; hinted: hint texts given. Those are earned."""
    out: list[str] = []
    out += [h.text for h in case.hints if h.text not in hinted]
    # Interrogation script: every authored reply, except those the player has actually been given.
    out += [text for _, _, text in all_response_ids(case) if text not in heard]
    for s in case.suspects:
        out += [s.truth, *s.secrets, s.voice.voice]
    for e in case.evidence:
        out.append(e.relevance)
        out += [f'"{t}"' for t in e.unlock.triggers]
        if e.id not in unlocked:
            out += [e.title, e.summary, *e.details]
    for c in case.contradictions:
        if c.id not in proven:
            out.append(c.explanation)
    out += [t.text for t in case.timeline]
    sol = case.solution
    out += [sol.summary, sol.motive, *sol.method, *sol.innocents.values()]
    out += [r.label for r in sol.rubric]
    out.append(case.narrator.voice.voice)
    return [h for h in out if len(h) >= 5]


def assert_no_leak(payload, case, unlocked, heard=frozenset(), proven=frozenset(), hinted=frozenset()):
    blob = json.dumps(payload, ensure_ascii=False)
    leaked = [h for h in hidden_strings(case, unlocked, heard, proven, hinted) if h in blob]
    assert not leaked, f"hidden content leaked: {leaked[:3]}"
    for key in (
        "culprit", "solution", "truth", "secrets", "relevance", "unlock", "contradictions", "timeline",
        "decisive", "points", "done_when", "claim_ids",
    ):
        assert f'"{key}"' not in blob, f"hidden key {key!r} present in response"


def test_no_leaks_across_pre_resolution_endpoints(client, case001):
    state = client.post("/api/sessions", json={"case_id": "case_001"}).json()
    sid = state["id"]
    unlocked = {e["id"] for e in state["evidence"]}

    responses = [
        client.get("/api/cases").json(),
        client.get("/api/player/me").json(),
        state,
        client.get(f"/api/sessions/{sid}").json(),
        client.post(f"/api/sessions/{sid}/briefing-complete").json(),
    ]
    for payload in responses:
        assert_no_leak(payload, case001, unlocked)


def test_locked_evidence_not_in_state(client, case001):
    state = client.post("/api/sessions", json={"case_id": "case_001"}).json()
    ids = {e["id"] for e in state["evidence"]}
    locked = {e.id for e in case001.evidence if not e.unlock.initial}
    assert ids.isdisjoint(locked)


def test_full_game_sweep_leaks_nothing_until_the_accusation(client, case001):
    """Play part of the case, checking every response on the way, then confirm the answer key appears
    only after the accusation closes the case."""
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    client.post(f"/api/sessions/{s}/briefing-complete")
    heard: set[str] = set()
    hinted: set[str] = set()
    proven: set[str] = set()
    payloads = []

    def keep(r):
        assert r.status_code < 500, r.text
        body = r.json() if r.content else None
        payloads.append(body)
        return body

    for suspect, q, ev in [
        ("kabir", "Where were you this morning?", None),
        ("kabir", "", "E4"),
        ("ramesh", "Where are the spare keys?", None),
        ("riya", "Who do you think did it?", None),
        ("mehta", "What is your favourite film?", None),
    ]:
        body = keep(client.post(f"/api/sessions/{s}/suspects/{suspect}/ask", json={"question": q, **({"evidence_id": ev} if ev else {})}))
        heard.add(body["turn"]["reply"])
    for claim, ev in [("kabir_c1", "E4"), ("mehta_c1", "E2")]:
        body = keep(client.post(f"/api/sessions/{s}/board/links", json={"claim_id": claim, "evidence_id": ev}))
        if body["contradiction"]:
            proven.add(body["contradiction"]["id"])
    hint = keep(client.post(f"/api/sessions/{s}/board/hint"))
    hinted.add(hint["hint"])
    keep(client.post(f"/api/sessions/{s}/board/timeline", json={"time": "08:16", "text": "K leaves"}))
    for path in ("", "/turns"):
        keep(client.get(f"/api/sessions/{s}{path}"))
    for path in ("/api/cases", "/api/player/me", "/api/player/history", "/api/voice/status"):
        keep(client.get(path))
    locked = client.get(f"/api/sessions/{s}/resolution")
    assert locked.status_code == 409
    payloads.append(locked.json())

    unlocked = {e["id"] for e in client.get(f"/api/sessions/{s}").json()["evidence"]}
    for p in payloads:
        assert_no_leak(p, case001, unlocked, heard=heard, proven=proven, hinted=hinted)

    after = client.post(f"/api/sessions/{s}/accuse", json={"suspect_id": "kabir", "explanation": "He left at 8:16."}).json()
    assert after["summary"] == case001.solution.summary and after["culprit_id"] == "kabir"
