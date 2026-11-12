"""Live Prisma STT check against the real Gnani API (uses credits: one call per file).

Usage (from backend/):
    .venv\\Scripts\\python -m scripts.stt_smoke path\\to\\audio.wav [more files...]
    .venv\\Scripts\\python -m scripts.stt_smoke --model prisma-v2.5 file.ogg
"""

import argparse
import asyncio
import mimetypes
import sys
from pathlib import Path

from app.config import get_settings
from app.engine.case_loader import get_case
from app.voice import stt
from app.voice.audio_utils import AudioRejected, check_upload
from app.voice.gnani_client import GnaniClient, GnaniError

TYPES = {".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4"}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--model", default=None, help="override STT model (default from settings)")
    ap.add_argument("--no-hints", action="store_true", help="don't send case keyterms/topic")
    args = ap.parse_args()

    s = get_settings()
    if not s.gnani_configured:
        print("GNANI_API_KEY is not set in backend/.env")
        return 2
    case = get_case("case_001")
    client = GnaniClient(s.gnani_api_key, s.gnani_base_url, max_retries=s.gnani_max_retries)
    failures = 0
    try:
        for path in args.files:
            data = path.read_bytes()
            ctype = TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            try:
                check_upload(data, ctype)
                res = await stt.transcribe(
                    client, data, filename=path.name, content_type=ctype, language=s.stt_language,
                    preferred_model=args.model or s.stt_model,
                    keyterms=[] if args.no_hints else case.stt.keyterms,
                    topic=None if args.no_hints else case.stt.topic,
                    timeout=s.stt_timeout_s,
                )
                print(f"✓ {path.name}: [{res.model}, {res.latency_ms} ms, lang={res.detected_language}] {res.transcript!r}")
            except AudioRejected as e:
                failures += 1
                print(f"✗ {path.name}: rejected locally ({e.code}): {e}")
            except GnaniError as e:
                failures += 1
                print(f"✗ {path.name}: {e.code} (HTTP {e.status}): {e.detail}")
    finally:
        await client.aclose()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
