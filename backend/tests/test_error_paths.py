"""What the player sees when things go wrong: Gnani busy, slow, unreachable or returning junk,
the backend given bad input, or an investigation that is closed."""

import httpx
import pytest

from app.main import app
from app.voice.gnani_client import GnaniClient
from app.voice.tts import TtsService, get_tts

from .test_voice_stt import Recorder
from .test_voice_tts import audio_ok


@pytest.fixture
def sid(client):
    s = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    client.post(f"/api/sessions/{s}/briefing-complete")
    return s


@pytest.fixture
def tts(tmp_path):
    rec = Recorder()
    svc = TtsService(GnaniClient("k", "https://gnani.test", backoff_s=(0, 0), transport=httpx.MockTransport(rec)), tmp_path)
    app.dependency_overrides[get_tts] = lambda: svc
    return rec, svc, tmp_path


def narration(client, sid):
    return client.get(f"/api/voice/sessions/{sid}/clips/narration")


BUSY = httpx.Response(429, json={"detail": {"error_code": "RATE_LIMITED", "message": "busy"}})


# ── voice (TTS) ──


def test_tts_busy_after_all_retries_is_429_with_a_friendly_message(client, sid, tts):
    rec, _, _ = tts
    rec.responses += [BUSY, BUSY, BUSY]
    r = narration(client, sid)
    assert r.status_code == 429 and r.json()["code"] == "busy"
    assert "busy" in r.json()["detail"].lower() and len(rec.requests) == 3  # 1 try + 2 retries


def test_tts_timeout_is_504(client, sid, tts):
    rec, _, _ = tts
    rec.responses += [httpx.ReadTimeout("slow")] * 3
    r = narration(client, sid)
    assert r.status_code == 504 and r.json()["code"] == "timeout"


def test_tts_network_failure_is_502_and_mentions_the_transcript(client, sid, tts):
    rec, _, _ = tts
    rec.responses += [httpx.ConnectError("down")] * 3
    r = narration(client, sid)
    assert r.status_code == 502 and r.json()["code"] == "network"
    assert "transcript" in r.json()["detail"]


def test_tts_junk_body_is_rejected_and_not_cached(client, sid, tts):
    rec, svc, cache = tts
    rec.responses += [httpx.Response(200, content=b"RIFF\x00\x00\x00\x00WAVEjunk"), audio_ok()]
    assert narration(client, sid).status_code == 502
    assert not list(cache.glob("*.wav"))
    assert narration(client, sid).status_code == 200  # recovers on the next try


def test_tts_empty_body_is_rejected(client, sid, tts):
    rec, _, _ = tts
    rec.responses.append(httpx.Response(200, content=b""))
    assert narration(client, sid).status_code == 502


def test_tts_recovers_after_a_transient_error(client, sid, tts):
    rec, _, _ = tts
    rec.responses += [httpx.Response(503, text="maintenance"), audio_ok()]
    assert narration(client, sid).status_code == 200 and len(rec.requests) == 2


# ── bad input ──


@pytest.mark.parametrize(
    "path,body",
    [
        ("/suspects/kabir/ask", {"question": "x" * 501}),
        ("/suspects/kabir/ask", {"question": "hi", "mode": "telepathy"}),
        ("/board/links", {"claim_id": "kabir_c1"}),
        ("/board/timeline", {"time": "25:00", "text": "x"}),
        ("/board/timeline", {"time": "08:00", "text": ""}),
        ("/notes", {"text": ""}),
        ("/accuse", {"suspect_id": "kabir", "explanation": "x" * 4001}),
        ("/accuse", {"suspect_id": "kabir", "explanation": "x", "evidence_ids": [f"E{i}" for i in range(11)]}),
    ],
)
def test_malformed_requests_are_422_with_a_readable_detail(client, sid, path, body):
    r = client.post(f"/api/sessions/{sid}{path}", json=body)
    assert r.status_code == 422
    assert "detail" in r.json()


def test_unknown_session_is_404_everywhere(client):
    for method, path in [
        ("get", "/api/sessions/nope"),
        ("get", "/api/sessions/nope/turns"),
        ("get", "/api/sessions/nope/resolution"),
        ("post", "/api/sessions/nope/board/hint"),
        ("post", "/api/sessions/nope/suspects/kabir/ask"),
    ]:
        r = getattr(client, method)(path, **({"json": {"question": "hi"}} if method == "post" else {}))
        assert r.status_code == 404, path


def test_unknown_case_is_404(client):
    assert client.post("/api/sessions", json={"case_id": "case_999"}).status_code == 404


def test_closed_case_rejects_every_change(client, sid):
    client.post(f"/api/sessions/{sid}/accuse", json={"suspect_id": "riya", "explanation": "She lied."})
    base = f"/api/sessions/{sid}"
    for path, body in [
        ("/suspects/kabir/ask", {"question": "hi"}),
        ("/board/links", {"claim_id": "kabir_c1", "evidence_id": "E4"}),
        ("/board/hint", None),
        ("/board/timeline", {"time": "08:00", "text": "x"}),
        ("/notes", {"text": "x"}),
        ("/accuse", {"suspect_id": "kabir", "explanation": "x"}),
    ]:
        r = client.post(base + path, json=body) if body is not None else client.post(base + path)
        assert r.status_code == 409, path
        assert "closed" in r.json()["detail"]
