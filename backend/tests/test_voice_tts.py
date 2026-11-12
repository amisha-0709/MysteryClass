"""TTS pipeline tests with a mocked Gnani transport (no network, no credits)."""

import asyncio
import json
import struct
import wave

import httpx
import pytest

from app.main import app
from app.schemas.case import VoiceConfig
from app.voice import tts as tts_mod
from app.voice.clips import resolve_clip, static_clips
from app.voice.gnani_client import GnaniClient, GnaniError
from app.voice.tts import TtsService, cache_key, extract_pcm, get_tts, split_text

from .audio_fixtures import make_wav
from .test_voice_stt import Recorder

VOICE = VoiceConfig(model="timbre-v2.5", voice="Kaveri", language="en-IN", speed=0.95)


def timbre_wav(seconds=0.5, rate=24000) -> bytes:
    """A WAV the way Timbre sends it: valid PCM but 0xFFFFFFFF in the RIFF and data size fields."""
    b = bytearray(make_wav(seconds, rate))
    b[4:8] = b"\xff\xff\xff\xff"
    d = b.find(b"data")
    b[d + 4 : d + 8] = b"\xff\xff\xff\xff"
    return bytes(b)


def audio_ok(seconds=0.5) -> httpx.Response:
    return httpx.Response(200, content=timbre_wav(seconds), headers={"content-type": "audio/wav"})


def service(rec: Recorder, tmp_path, key="test-key") -> TtsService:
    client = GnaniClient(key, "https://gnani.test", backoff_s=(0, 0), transport=httpx.MockTransport(rec))
    return TtsService(client, tmp_path)


def run(coro):
    return asyncio.run(coro)


# ── text + audio helpers ───────────────────────────────────────────────


def test_split_text_keeps_short_text_whole_and_packs_sentences():
    assert split_text("  Hello   there. ") == ["Hello there."]
    text = " ".join(f"Sentence number {i} is here." for i in range(60))
    chunks = split_text(text, limit=200)
    assert all(len(c) <= 200 for c in chunks)
    assert " ".join(chunks) == " ".join(text.split())
    assert all(c.endswith(".") for c in chunks)  # never cut mid-sentence when sentences fit


def test_split_text_breaks_an_overlong_sentence():
    chunks = split_text("word " * 300, limit=100)
    assert chunks and all(len(c) <= 100 for c in chunks)


def test_extract_pcm_handles_placeholder_sizes_and_raw_pcm():
    pcm, rate, ch, width = extract_pcm(timbre_wav(0.5))
    assert (rate, ch, width) == (24000, 1, 2) and len(pcm) == 24000  # 0.5 s × 24 kHz × 2 bytes
    raw = b"\x01\x00" * 100
    assert extract_pcm(raw) == (raw, 24000, 1, 2)
    with pytest.raises(GnaniError):
        extract_pcm(b"")


def test_cache_key_depends_on_every_voice_setting():
    base = cache_key(VOICE, "Hello.")
    assert base == cache_key(VOICE, "  Hello. ")  # whitespace-insensitive
    for change in ({"voice": "Pranav"}, {"model": "timbre-v3.0"}, {"language": "hi-en"}, {"speed": 1.0}):
        assert cache_key(VOICE.model_copy(update=change), "Hello.") != base
    assert cache_key(VOICE, "Hello!") != base


# ── service ────────────────────────────────────────────────────────────


def test_speak_sends_documented_payload_and_writes_a_valid_wav(tmp_path):
    rec = Recorder(audio_ok(0.5))
    clip = run(service(rec, tmp_path).speak(VOICE, "The paper is gone."))
    req = rec.requests[0]
    assert req.url.path == "/api/v1/tts/inference"
    assert req.headers["X-API-Key-ID"] == "test-key"
    body = json.loads(req.content)
    assert body == {
        "text": "The paper is gone.",
        "voice": "Kaveri",
        "model": "timbre-v2.5",
        "language": "en-IN",
        "speed": 0.95,
        "audio_config": {"sample_rate": 24000, "num_channels": 1, "sample_width": 2,
                         "encoding": "linear_pcm", "container": "wav"},
    }
    assert not clip.cached and clip.requests == 1 and clip.seconds == pytest.approx(0.5)
    data = clip.path.read_bytes()
    assert struct.unpack("<I", data[4:8])[0] == len(data) - 8  # real sizes, not the placeholder
    with wave.open(str(clip.path)) as w:
        assert w.getframerate() == 24000 and w.getnframes() == 12000


def test_second_request_is_served_from_cache(tmp_path):
    rec = Recorder(audio_ok())
    svc = service(rec, tmp_path)
    run(svc.speak(VOICE, "Once."))
    again = run(svc.speak(VOICE, "Once."))
    assert again.cached and again.requests == 0 and len(rec.requests) == 1


def test_concurrent_requests_for_one_clip_make_one_call(tmp_path):
    rec = Recorder(audio_ok())
    svc = service(rec, tmp_path)

    async def both():
        return await asyncio.gather(svc.speak(VOICE, "Same line."), svc.speak(VOICE, "Same line."))

    a, b = run(both())
    assert len(rec.requests) == 1 and a.path == b.path


def test_long_text_is_chunked_and_joined_with_a_pause(tmp_path, monkeypatch):
    monkeypatch.setattr(tts_mod, "MAX_CHUNK_CHARS", 40)
    rec = Recorder(audio_ok(0.5), audio_ok(0.5))
    text = "This is the first sentence here. And this is the second one."
    monkeypatch.setattr(tts_mod, "split_text", lambda t: split_text(t, limit=40))
    clip = run(service(rec, tmp_path).speak(VOICE, text))
    assert clip.requests == 2
    assert clip.seconds == pytest.approx(1.0 + tts_mod.GAP_SECONDS, abs=0.01)


def test_speed_is_clamped_to_the_documented_range(tmp_path):
    rec = Recorder(audio_ok())
    run(service(rec, tmp_path).speak(VOICE.model_copy(update={"speed": 1.4}), "Fast."))
    assert json.loads(rec.requests[0].content)["speed"] == 1.15


def test_tts_error_shape_is_parsed_and_nothing_is_cached(tmp_path):
    rec = Recorder(httpx.Response(400, json={"success": False, "message": "Invalid voice", "status_code": 400}))
    svc = service(rec, tmp_path)
    with pytest.raises(GnaniError) as e:
        run(svc.speak(VOICE, "Hi."))
    assert e.value.code == "bad_request" and "Invalid voice" in e.value.detail
    assert svc.cached(VOICE, "Hi.") is None and not list(tmp_path.iterdir())


def test_busy_is_retried(tmp_path):
    rec = Recorder(httpx.Response(429, json={"detail": {"error_code": "RATE_LIMITED", "message": "busy"}}), audio_ok())
    clip = run(service(rec, tmp_path).speak(VOICE, "Retry me."))
    assert len(rec.requests) == 2 and clip.path.is_file()


# ── clips ──────────────────────────────────────────────────────────────


def test_static_clips_cover_narration_and_every_statement(case001):
    ids = {c.id for c in static_clips(case001)}
    assert ids == {"narration"} | {f"statement.{s.id}" for s in case001.suspects}
    assert resolve_clip(case001, "statement.kabir").voice.voice == case001.suspect("kabir").voice.voice
    assert resolve_clip(case001, "statement.nobody") is None


# ── endpoint ───────────────────────────────────────────────────────────


@pytest.fixture
def tts_override(tmp_path):
    rec = Recorder()
    svc = service(rec, tmp_path)
    app.dependency_overrides[get_tts] = lambda: svc
    yield rec, svc


def _session(client) -> str:
    return client.post("/api/sessions", json={"case_id": "case_001"}).json()["id"]


def test_clip_endpoint_returns_wav_then_serves_cache(client, tts_override):
    rec, _ = tts_override
    rec.responses.append(audio_ok())
    sid = _session(client)
    r = client.get(f"/api/voice/sessions/{sid}/clips/narration")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert r.content[:4] == b"RIFF" and r.headers["x-clip-cached"] == "0"
    r2 = client.get(f"/api/voice/sessions/{sid}/clips/narration")
    assert r2.headers["x-clip-cached"] == "1" and len(rec.requests) == 1
    assert json.loads(rec.requests[0].content)["text"].startswith("Northbridge University")


def test_clip_endpoint_rejects_unknown_clips_and_sessions(client, tts_override):
    rec, _ = tts_override
    sid = _session(client)
    assert client.get(f"/api/voice/sessions/{sid}/clips/solution").json()["code"] == "not_found"
    assert client.get("/api/voice/sessions/nope/clips/narration").status_code == 404
    assert rec.requests == []  # never paid for anything


def test_clip_endpoint_maps_gnani_errors(client, tts_override):
    rec, _ = tts_override
    rec.responses += [httpx.Response(402, json={"detail": {"error_code": "X", "message": "no credits"}})]
    sid = _session(client)
    r = client.get(f"/api/voice/sessions/{sid}/clips/statement.riya")
    assert r.status_code == 502 and r.json()["code"] == "credits"
    assert "transcript" in r.json()["detail"]


def test_clip_endpoint_without_key_is_503_but_cached_clips_still_play(client, tmp_path, case001):
    svc = TtsService(GnaniClient("", "https://gnani.test"), tmp_path)
    app.dependency_overrides[get_tts] = lambda: svc
    sid = _session(client)
    r = client.get(f"/api/voice/sessions/{sid}/clips/narration")
    assert r.status_code == 503 and r.json()["code"] == "not_configured"
    assert client.get("/api/voice/status").json()["tts"] is False

    spec = resolve_clip(case001, "narration")
    svc.path_for(cache_key(spec.voice, spec.text)).write_bytes(make_wav(0.2, 24000))
    assert client.get(f"/api/voice/sessions/{sid}/clips/narration").status_code == 200
