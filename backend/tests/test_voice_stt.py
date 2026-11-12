"""STT pipeline tests with a mocked Gnani transport (no network, no credits)."""

import asyncio
import json

import httpx
import pytest

from app.main import app
from app.voice import stt
from app.voice.audio_utils import AudioRejected, check_upload
from app.voice.gnani_client import GnaniClient, GnaniError, get_gnani

from .audio_fixtures import make_wav


class Recorder:
    """httpx MockTransport handler that replays scripted responses and records requests."""

    def __init__(self, *responses: httpx.Response | Exception):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def form(self, i: int) -> dict[str, str]:
        """Parse simple (non-file) multipart fields out of a recorded request."""
        req = self.requests[i]
        boundary = req.headers["content-type"].split("boundary=")[1].encode()
        fields = {}
        for part in req.content.split(b"--" + boundary):
            head, _, body = part.partition(b"\r\n\r\n")
            if b'name="' in head and b"filename=" not in head:
                name = head.split(b'name="')[1].split(b'"')[0].decode()
                fields[name] = body.rstrip(b"\r\n").decode()
        return fields


def ok(transcript="where were you at 8:15", model="prisma-v3.0") -> httpx.Response:
    return httpx.Response(200, json={"success": True, "request_id": "r1", "transcript": transcript, "model": model})


def client_for(rec: Recorder, key="test-key") -> GnaniClient:
    return GnaniClient(key, "https://gnani.test", backoff_s=(0, 0), transport=httpx.MockTransport(rec))


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _reset_model_cache():
    stt.reset_model_cache()
    yield
    stt.reset_model_cache()


# ── client / service ───────────────────────────────────────────────────


def test_transcribe_v3_sends_auth_model_and_keyterms():
    rec = Recorder(ok())
    res = run(
        stt.transcribe(client_for(rec), make_wav(), filename="q.wav", content_type="audio/wav",
                       keyterms=["Kabir", "F-301"], topic="exam theft")
    )
    assert res.transcript == "where were you at 8:15" and res.model == "prisma-v3.0"
    req = rec.requests[0]
    assert req.url.path == "/stt/v3"
    assert req.headers["X-API-Key-ID"] == "test-key"
    form = rec.form(0)
    assert form["model"] == "prisma-v3.0"
    assert form["language_code"] == "en-IN" and form["format"] == "transcribe"
    assert json.loads(form["keyterms"]) == ["Kabir", "F-301"]
    assert form["topic"] == "exam theft"


def test_falls_back_to_v25_when_v3_unavailable_and_remembers():
    rec = Recorder(
        httpx.Response(400, json={"success": False, "error": {"type": "INVALID_MODEL", "message": "nope"}}),
        ok(model="prisma-v2.5"),
        ok(model="prisma-v2.5"),
    )
    c = client_for(rec)
    res = run(stt.transcribe(c, make_wav(), filename="q.wav", content_type="audio/wav", keyterms=["Kabir"]))
    assert res.model == "prisma-v2.5"
    assert "model" not in rec.form(1) and "keyterms" not in rec.form(1)
    run(stt.transcribe(c, make_wav(), filename="q.wav", content_type="audio/wav"))
    assert len(rec.requests) == 3  # second call went straight to v2.5, no failing v3 attempt
    assert "model" not in rec.form(2)


def test_retries_rate_limit_then_succeeds():
    rec = Recorder(
        httpx.Response(429, json={"detail": {"error_code": "RATE_LIMITED", "message": "busy", "status_code": 429}}),
        ok(),
    )
    res = run(stt.transcribe(client_for(rec), make_wav(), filename="q.wav", content_type="audio/wav"))
    assert res.transcript and len(rec.requests) == 2


def test_gives_up_after_max_retries_on_timeout():
    rec = Recorder(httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow"))
    with pytest.raises(GnaniError) as e:
        run(stt.transcribe(client_for(rec), make_wav(), filename="q.wav", content_type="audio/wav"))
    assert e.value.code == "timeout" and len(rec.requests) == 3


def test_gateway_timeout_shape_is_parsed():
    body = {"error": "Gateway Timeout", "code": "UPSTREAM_TIMEOUT", "message": "model did not respond"}
    rec = Recorder(*[httpx.Response(504, json=body)] * 3)
    with pytest.raises(GnaniError) as e:
        run(stt.transcribe(client_for(rec), make_wav(), filename="q.wav", content_type="audio/wav"))
    assert e.value.code == "timeout"


def test_auth_error_is_not_retried():
    rec = Recorder(httpx.Response(401, json={"detail": {"error_code": "INVALID_API_KEY", "message": "bad"}}))
    with pytest.raises(GnaniError) as e:
        run(stt.transcribe(client_for(rec), make_wav(), filename="q.wav", content_type="audio/wav"))
    assert e.value.code == "auth" and len(rec.requests) == 1


def test_unconfigured_client_never_calls_network():
    rec = Recorder()
    with pytest.raises(GnaniError) as e:
        run(stt.transcribe(client_for(rec, key=""), make_wav(), filename="q.wav", content_type="audio/wav"))
    assert e.value.code == "not_configured" and rec.requests == []


# ── local audio checks ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "data, ctype, code",
    [
        (make_wav(31), "audio/wav", "too_long"),
        (make_wav(0.1), "audio/wav", "too_short"),
        (make_wav(1, amplitude=0.001), "audio/wav", "silent"),
        (b"not a wav", "audio/wav", "bad_audio"),
        (b"\x1aE\xdf\xa3webm", "audio/webm", "bad_audio"),
        (b"", "audio/ogg", "empty"),
    ],
)
def test_check_upload_rejects(data, ctype, code):
    with pytest.raises(AudioRejected) as e:
        check_upload(data, ctype)
    assert e.value.code == code


def test_wav_with_placeholder_riff_size_measures_real_duration():
    """Timbre-style streaming WAVs write 0xFFFFFFFF as the size; trust the bytes, not the header."""
    data = bytearray(make_wav(2.0))
    data[4:8] = (0xFFFFFFFF).to_bytes(4, "little")
    data[40:44] = (0xFFFFFFFF).to_bytes(4, "little")  # data chunk size
    from app.voice.audio_utils import inspect_wav

    assert abs(inspect_wav(bytes(data)).seconds - 2.0) < 0.01
    assert check_upload(bytes(data), "audio/wav") == ".wav"


def test_check_upload_accepts_speechlike_wav_and_ogg():
    assert check_upload(make_wav(2), "audio/wav;codecs=1") == ".wav"
    assert check_upload(b"OggS....", "audio/ogg") == ".ogg"


# ── endpoint ─────────────────────────────────────────────────────────


@pytest.fixture
def gnani_mock():
    holder: dict = {}

    def install(*responses, key="test-key"):
        rec = Recorder(*responses)
        app.dependency_overrides[get_gnani] = lambda: client_for(rec, key)
        holder["rec"] = rec
        return rec

    yield install
    app.dependency_overrides.pop(get_gnani, None)


def post_audio(client, data, ctype="audio/wav", **form):
    return client.post("/api/voice/stt", files={"audio": ("rec.wav", data, ctype)}, data=form)


def test_endpoint_transcribes_with_case_keyterms(client, gnani_mock):
    rec = gnani_mock(ok("Kabir where were you"))
    sid = client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]
    res = post_audio(client, make_wav(2), session_id=sid, purpose="question")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["transcript"] == "Kabir where were you" and body["empty"] is False
    assert "Kabir Malhotra" in json.loads(rec.form(0)["keyterms"])


def test_endpoint_rejects_silence_without_calling_gnani(client, gnani_mock):
    rec = gnani_mock()
    res = post_audio(client, make_wav(1, amplitude=0.001))
    assert res.status_code == 422 and res.json()["code"] == "silent"
    assert rec.requests == []


def test_endpoint_reports_not_configured(client, gnani_mock):
    gnani_mock(key="")
    res = post_audio(client, make_wav(1))
    assert res.status_code == 503 and res.json()["code"] == "not_configured"


def test_endpoint_maps_upstream_errors_to_friendly_messages(client, gnani_mock):
    gnani_mock(*[httpx.Response(503, json={"detail": "down"})] * 3)
    res = post_audio(client, make_wav(1))
    assert res.status_code == 502 and res.json()["code"] == "unavailable"
    assert "type instead" in res.json()["detail"]


def test_endpoint_flags_empty_transcript(client, gnani_mock):
    gnani_mock(ok(""))
    res = post_audio(client, make_wav(1))
    assert res.status_code == 200 and res.json()["empty"] is True


def test_endpoint_rejects_unknown_session(client, gnani_mock):
    gnani_mock(ok())
    assert post_audio(client, make_wav(1), session_id="nope").status_code == 404
