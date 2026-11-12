"""Thin async client for Gnani Vachana (Prisma STT, Timbre TTS).

Facts this relies on (docs.gnani.ai, verified 2026-11-12):
  * Auth header: X-API-Key-ID
  * One active request per account; a second concurrent one gets 429 → we serialize with a
    process-wide semaphore and retry 429/503/504 with backoff.
  * Error bodies come in several shapes (see _parse_error).
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("mysteryclass.gnani")

RETRYABLE_STATUS = {429, 503, 504}

# Error type strings from the STT docs → our error codes.
_STT_TYPES = {
    "EMPTY_AUDIO": "empty",
    "MAX_AUDIO_DURATION_EXCEEDED": "too_long",
    "UNSUPPORTED_AUDIO_FORMAT": "bad_audio",
    "AUDIO_CONVERSION_ERROR": "bad_audio",
    "INVALID_MODEL": "model_unavailable",
    "MODEL_UNSUPPORTED_LANGUAGE": "model_unavailable",
    "SCOPE_NOT_ALLOWED": "model_unavailable",
    "INVALID_LANGUAGE_CODE": "bad_request",
    "INVALID_FORMAT": "bad_request",
    "INVALID_CONTEXT": "bad_request",
    "MISSING_API_KEY": "auth",
    "INVALID_API_KEY": "auth",
    "RATE_LIMITED": "busy",
    "UPSTREAM_TIMEOUT": "timeout",
}

USER_MESSAGES = {
    "not_configured": "Voice isn't configured on the server. You can type instead.",
    "auth": "The voice service rejected our credentials. You can type instead.",
    "credits": "The voice service is out of credits. You can type instead.",
    "busy": "The voice service is busy. Try again in a moment.",
    "timeout": "The voice service took too long to respond. Try again.",
    "unavailable": "The voice service is unavailable right now. You can type instead.",
    "network": "Couldn't reach the voice service. Check the connection, or type instead.",
    "empty": "We couldn't hear anything in that recording.",
    "too_long": "That recording is too long. Keep it under 30 seconds.",
    "bad_audio": "That recording couldn't be processed. Try again.",
    "model_unavailable": "That voice model isn't available for this account.",
    "bad_request": "The voice service rejected the request.",
    "unknown": "Something went wrong with the voice service. Try again, or type instead.",
}


class GnaniError(Exception):
    def __init__(self, code: str, detail: str = "", status: int | None = None):
        self.code = code
        self.detail = detail
        self.status = status
        super().__init__(f"{code} (HTTP {status}): {detail}")

    @property
    def user_message(self) -> str:
        return USER_MESSAGES.get(self.code, USER_MESSAGES["unknown"])

    @property
    def retryable(self) -> bool:
        return self.code in {"busy", "timeout", "unavailable", "network"}


@dataclass
class GnaniResponse:
    status: int
    headers: httpx.Headers
    content: bytes
    elapsed_ms: int

    def json(self) -> Any:
        import json

        return json.loads(self.content)


def _parse_error(res: httpx.Response) -> GnaniError:
    status = res.status_code
    detail = res.text[:300]
    err_type = None
    try:
        body = res.json()
        if isinstance(body.get("error"), dict):  # STT envelope
            err_type = body["error"].get("type")
            detail = body["error"].get("message", detail)
        elif isinstance(body.get("detail"), dict):  # auth / rate-limit shape
            err_type = body["detail"].get("error_code")
            detail = body["detail"].get("message", detail)
        elif "code" in body:  # gateway timeout shape
            err_type = body.get("code")
            detail = body.get("message", detail)
        elif "message" in body:  # TTS flat shape
            detail = body["message"]
    except ValueError:
        pass

    code = _STT_TYPES.get(err_type or "")
    if code is None:
        code = {
            401: "auth",
            402: "credits",
            403: "model_unavailable" if err_type == "SCOPE_NOT_ALLOWED" else "auth",
            429: "busy",
            503: "unavailable",
            504: "timeout",
        }.get(status, "bad_request" if 400 <= status < 500 else "unavailable")
    return GnaniError(code, detail, status)


class GnaniClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        *,
        max_retries: int = 2,
        backoff_s: tuple[float, ...] = (0.5, 1.5),
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries
        self._backoff = backoff_s
        self._transport = transport
        self._http: httpx.AsyncClient | None = None
        self._lock = asyncio.Semaphore(1)  # Gnani allows one active request per account

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(base_url=self._base_url, transport=self._transport)
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def post(
        self,
        path: str,
        *,
        timeout: float,
        data: dict[str, str] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
        json: dict[str, Any] | None = None,
    ) -> GnaniResponse:
        if not self.configured:
            raise GnaniError("not_configured", "GNANI_API_KEY is not set")

        headers = {"X-API-Key-ID": self._api_key}
        attempt = 0
        while True:
            try:
                async with self._lock:
                    t0 = time.perf_counter()
                    res = await self._client().post(
                        path, headers=headers, data=data, files=files, json=json, timeout=timeout
                    )
                    elapsed = int((time.perf_counter() - t0) * 1000)
                if res.is_success:
                    log.info("gnani %s ok %dms", path, elapsed)
                    return GnaniResponse(res.status_code, res.headers, res.content, elapsed)
                error = _parse_error(res)
            except httpx.TimeoutException as e:
                error = GnaniError("timeout", str(e) or "request timed out")
            except httpx.TransportError as e:
                error = GnaniError("network", str(e) or type(e).__name__)

            log.warning("gnani %s failed (attempt %d): %s", path, attempt + 1, error)
            if not error.retryable or attempt >= self._max_retries:
                raise error
            await asyncio.sleep(self._backoff[min(attempt, len(self._backoff) - 1)])
            attempt += 1


_client: GnaniClient | None = None


def get_gnani() -> GnaniClient:
    """Process-wide client (FastAPI dependency; tests override it)."""
    global _client
    if _client is None:
        from ..config import get_settings

        s = get_settings()
        _client = GnaniClient(s.gnani_api_key, s.gnani_base_url, max_retries=s.gnani_max_retries)
    return _client


async def close_gnani() -> None:
    if _client is not None:
        await _client.aclose()
