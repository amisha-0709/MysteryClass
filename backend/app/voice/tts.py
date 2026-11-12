"""Gnani Timbre TTS: synthesise a line in a character's voice, cached on disk.

Facts this relies on (docs.gnani.ai + live probes on 2026-11-13 with our key):
  * POST /api/v1/tts/inference, JSON {text, voice, model, language, speed, audio_config}; the body is raw audio.
  * timbre-v2.5 and timbre-v3.0 both work on our key. 24 kHz mono 16-bit WAV is accepted.
  * The returned WAV has placeholder RIFF/data sizes (0xFFFFFFFF), so we re-wrap the PCM with real sizes.
  * A 609-character text came back fine in one call. The max length is undocumented, so long texts are
    split on sentence boundaries into chunks of at most MAX_CHUNK_CHARS and joined with a short pause.

Every synthesised line costs one paid request per chunk, so clips are cached forever by
sha256(model|voice|language|speed|rate|text). Concurrent requests for the same clip share one call.
"""

import asyncio
import hashlib
import io
import logging
import os
import re
import struct
import wave
from dataclasses import dataclass
from pathlib import Path

from ..schemas.case import VoiceConfig
from .gnani_client import GnaniClient, GnaniError

log = logging.getLogger("mysteryclass.tts")

TTS_PATH = "/api/v1/tts/inference"
SAMPLE_RATE = 24000
SAMPLE_WIDTH = 2
CHANNELS = 1
MAX_CHUNK_CHARS = 700
GAP_SECONDS = 0.18
SPEED_RANGE = (0.85, 1.15)


@dataclass(frozen=True)
class Clip:
    key: str
    path: Path
    seconds: float
    cached: bool  # True when served from disk without a Gnani call
    requests: int  # paid Gnani calls made for this clip (0 when cached)


def split_text(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """Pack whole sentences into chunks ≤ limit. A single overlong sentence is split at commas, then spaces."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return [text] if text else []

    def pieces(s: str) -> list[str]:
        if len(s) <= limit:
            return [s]
        for sep in (", ", " "):
            parts = s.split(sep)
            if len(parts) > 1:
                out, cur = [], ""
                for p in parts:
                    cand = f"{cur}{sep}{p}" if cur else p
                    if len(cand) <= limit:
                        cur = cand
                    else:
                        if cur:
                            out.append(cur + (sep.strip() if sep != " " else ""))
                        cur = p
                if cur:
                    out.append(cur)
                return [q for o in out for q in pieces(o)]
        return [s[i : i + limit] for i in range(0, len(s), limit)]

    sentences = [p for s in re.split(r"(?<=[.!?…])\s+", text) for p in pieces(s)]
    chunks, cur = [], ""
    for s in sentences:
        cand = f"{cur} {s}" if cur else s
        if len(cand) <= limit:
            cur = cand
        else:
            chunks.append(cur)
            cur = s
    if cur:
        chunks.append(cur)
    return chunks


def extract_pcm(content: bytes) -> tuple[bytes, int, int, int]:
    """Return (pcm, sample_rate, channels, sample_width) from a Timbre response.

    Walks RIFF chunks by hand because Timbre writes 0xFFFFFFFF as the data size; in that case the data
    runs to the end of the body. Bodies without a RIFF header are treated as raw PCM in our requested format.
    """
    if not content:
        raise GnaniError("bad_audio", "TTS returned an empty body")
    if content[:4] != b"RIFF" or content[8:12] != b"WAVE":
        rate, ch, width, pcm = SAMPLE_RATE, CHANNELS, SAMPLE_WIDTH, content
    else:
        rate = ch = width = None
        pcm = b""
        pos = 12
        while pos + 8 <= len(content):
            cid, size = content[pos : pos + 4], struct.unpack("<I", content[pos + 4 : pos + 8])[0]
            body_start = pos + 8
            if cid == b"fmt ":
                fmt_tag, ch, rate = struct.unpack("<HHI", content[body_start : body_start + 8])
                width = struct.unpack("<H", content[body_start + 14 : body_start + 16])[0] // 8
                if fmt_tag != 1:
                    raise GnaniError("bad_audio", f"unsupported WAV format tag {fmt_tag}")
            elif cid == b"data":
                end = len(content) if size == 0xFFFFFFFF else min(len(content), body_start + size)
                pcm = content[body_start:end]
                break
            pos = body_start + size + (size & 1)
        if not (rate and ch and width):
            raise GnaniError("bad_audio", "TTS WAV has no fmt chunk")
    frame = ch * width
    pcm = pcm[: len(pcm) - len(pcm) % frame]
    if not pcm:
        raise GnaniError("bad_audio", "TTS returned no audio frames")
    return pcm, rate, ch, width


def build_wav(pcm: bytes, rate: int, channels: int, width: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def cache_key(voice: VoiceConfig, text: str) -> str:
    norm = " ".join(text.split())
    raw = f"{voice.model}|{voice.voice}|{voice.language}|{voice.speed:.2f}|{SAMPLE_RATE}|{norm}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class TtsService:
    def __init__(self, client: GnaniClient, cache_dir: Path, *, timeout: float = 30.0):
        self._client = client
        self._dir = cache_dir
        self._timeout = timeout
        self._locks: dict[str, asyncio.Lock] = {}

    @property
    def configured(self) -> bool:
        return self._client.configured

    def path_for(self, key: str) -> Path:
        return self._dir / f"{key}.wav"

    def cached(self, voice: VoiceConfig, text: str) -> Path | None:
        p = self.path_for(cache_key(voice, text))
        return p if p.is_file() else None

    async def speak(self, voice: VoiceConfig, text: str) -> Clip:
        key = cache_key(voice, text)
        path = self.path_for(key)
        if path.is_file():
            return Clip(key, path, wav_seconds(path), cached=True, requests=0)

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if path.is_file():  # another request finished it while we waited
                return Clip(key, path, wav_seconds(path), cached=True, requests=0)
            chunks = split_text(text)
            if not chunks:
                raise GnaniError("bad_request", "nothing to say")

            fmt: tuple[int, int, int] | None = None
            parts: list[bytes] = []
            for chunk in chunks:
                res = await self._client.post(TTS_PATH, json=self._payload(voice, chunk), timeout=self._timeout)
                pcm, rate, ch, width = extract_pcm(res.content)
                if fmt is None:
                    fmt = (rate, ch, width)
                elif fmt != (rate, ch, width):
                    raise GnaniError("bad_audio", "TTS chunks came back in different formats")
                if parts:
                    parts.append(b"\x00" * (int(rate * GAP_SECONDS) * ch * width))
                parts.append(pcm)

            assert fmt is not None
            data = build_wav(b"".join(parts), *fmt)
            self._dir.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(f".{os.getpid()}.tmp")
            tmp.write_bytes(data)
            os.replace(tmp, path)  # atomic: a half-written file is never served
            self._locks.pop(key, None)
            log.info("tts %s/%s %d chunk(s) → %s", voice.model, voice.voice, len(chunks), path.name)
            return Clip(key, path, wav_seconds(path), cached=False, requests=len(chunks))

    @staticmethod
    def _payload(voice: VoiceConfig, text: str) -> dict:
        lo, hi = SPEED_RANGE
        return {
            "text": text,
            "voice": voice.voice,
            "model": voice.model,
            "language": voice.language,
            "speed": round(min(hi, max(lo, voice.speed)), 2),
            "audio_config": {
                "sample_rate": SAMPLE_RATE,
                "num_channels": CHANNELS,
                "sample_width": SAMPLE_WIDTH,
                "encoding": "linear_pcm",
                "container": "wav",
            },
        }


_service: TtsService | None = None


def get_tts() -> TtsService:
    """Process-wide service (FastAPI dependency; tests override it)."""
    global _service
    if _service is None:
        from ..config import get_settings
        from .gnani_client import get_gnani

        _service = TtsService(get_gnani(), get_settings().audio_cache_dir)
    return _service
