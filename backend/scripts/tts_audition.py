"""Voice casting: render one line in several Timbre voices so you can listen and compare.

    .venv\\Scripts\\python -m scripts.tts_audition statement.kabir Shlok Devansh@timbre-v3.0 Avinash@timbre-v3.0
    .venv\\Scripts\\python -m scripts.tts_audition narration Kaveri Shivani@timbre-v3.0 --speed 0.95

A voice is NAME or NAME@MODEL (default model timbre-v2.5). Language defaults to the line's cast language.
Files go to backend/audio_cache/audition/. Each new voice costs one Gnani request. To recast, edit the
"voice" block in cases/<case>/case.json, then run scripts.pregen_audio.
"""

import argparse
import asyncio
import sys

from app.config import get_settings
from app.engine.case_loader import get_case
from app.schemas.case import VoiceConfig
from app.voice.clips import resolve_clip
from app.voice.gnani_client import GnaniError, close_gnani, get_gnani
from app.voice.tts import TtsService


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clip", help="clip id, e.g. narration or statement.riya")
    ap.add_argument("voices", nargs="+", help="NAME or NAME@MODEL")
    ap.add_argument("--case", default="case_001")
    ap.add_argument("--language", help="override the language (en-IN, hi-en, hi-IN …)")
    ap.add_argument("--speed", type=float, help="override the speed (0.85–1.15)")
    args = ap.parse_args()

    spec = resolve_clip(get_case(args.case), args.clip)
    if spec is None:
        print(f"No clip {args.clip!r} in {args.case}.")
        return 2

    out_dir = get_settings().audio_cache_dir / "audition"
    tts = TtsService(get_gnani(), out_dir)
    print(f"{spec.speaker}: “{spec.text[:80]}…”  (cast: {spec.voice.voice}, {spec.voice.model})\n")
    for v in args.voices:
        name, _, model = v.partition("@")
        voice = VoiceConfig(
            model=model or "timbre-v2.5",
            voice=name,
            language=args.language or spec.voice.language,
            speed=args.speed or spec.voice.speed,
        )
        try:
            clip = await tts.speak(voice, spec.text)
        except GnaniError as e:
            print(f"  {v:<24} FAILED: {e.detail or e.code}")
            continue
        dest = out_dir / f"{args.clip}_{name}_{voice.model}_{voice.language}_{voice.speed:.2f}.wav"
        dest.write_bytes(clip.path.read_bytes())
        print(f"  {v:<24} {clip.seconds:5.1f}s  {dest}")

    await close_gnani()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
