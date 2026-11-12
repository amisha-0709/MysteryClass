"""Gnani Prisma speech-to-text.

POST {base}/stt/v3, multipart/form-data:
  audio_file, language_code, format, model (v3.0 only), keyterms + topic (v3.0 only)
Response: {success, request_id, transcript, model, detected_language_code?, truncated?, ...}

We prefer prisma-v3.0 for its keyterm biasing (suspect names, places, objects). If this API
key can't use v3.0, we fall back to the default prisma-v2.5 and remember that for the
process lifetime, so we don't pay for a failing call every time.
"""

import json
import logging
from dataclasses import dataclass

from .gnani_client import GnaniClient, GnaniError

log = logging.getLogger("mysteryclass.stt")

STT_PATH = "/stt/v3"
V3 = "prisma-v3.0"
V25 = "prisma-v2.5"
MAX_KEYTERMS = 200
MAX_TOPIC = 1600

_v3_unavailable = False


@dataclass
class SttResult:
    transcript: str
    model: str
    latency_ms: int
    request_id: str | None = None
    detected_language: str | None = None
    truncated: bool = False


def reset_model_cache() -> None:
    global _v3_unavailable
    _v3_unavailable = False


def _payload(model: str, language: str, keyterms: list[str], topic: str | None) -> dict[str, str]:
    data = {"language_code": language, "format": "transcribe"}
    if model == V3:
        data["model"] = V3
        if keyterms:
            data["keyterms"] = json.dumps(keyterms[:MAX_KEYTERMS], ensure_ascii=False)
        if topic:
            data["topic"] = topic[:MAX_TOPIC]
    # prisma-v2.5 is the API default when `model` is omitted.
    return data


async def transcribe(
    client: GnaniClient,
    audio: bytes,
    *,
    filename: str,
    content_type: str,
    language: str = "en-IN",
    preferred_model: str = V3,
    keyterms: list[str] | None = None,
    topic: str | None = None,
    timeout: float = 15.0,
) -> SttResult:
    global _v3_unavailable
    model = V25 if (preferred_model == V3 and _v3_unavailable) else preferred_model

    async def call(m: str) -> SttResult:
        res = await client.post(
            STT_PATH,
            data=_payload(m, language, keyterms or [], topic),
            files={"audio_file": (filename, audio, content_type)},
            timeout=timeout,
        )
        try:
            body = res.json()
        except ValueError as e:
            raise GnaniError("unknown", "STT returned a non-JSON response", res.status) from e
        if body.get("success") is False:
            raise GnaniError("unknown", str(body)[:300], res.status)
        return SttResult(
            transcript=(body.get("transcript") or "").strip(),
            model=body.get("model") or m,
            latency_ms=res.elapsed_ms,
            request_id=body.get("request_id"),
            detected_language=body.get("detected_language_code"),
            truncated=bool(body.get("truncated")),
        )

    try:
        return await call(model)
    except GnaniError as e:
        if model == V3 and e.code == "model_unavailable":
            log.warning("prisma-v3.0 unavailable for this key (%s); falling back to prisma-v2.5", e.detail)
            _v3_unavailable = True
            return await call(V25)
        raise
