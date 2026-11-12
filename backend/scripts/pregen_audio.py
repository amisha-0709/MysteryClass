"""Render every authored line of a case to the TTS cache, so play costs no TTS calls.

    .venv\\Scripts\\python -m scripts.pregen_audio              # all cases
    .venv\\Scripts\\python -m scripts.pregen_audio --case case_001
    .venv\\Scripts\\python -m scripts.pregen_audio --dry-run    # show what would be generated

Already-cached lines are skipped (free). Each new line costs one Gnani request per ~700 characters.
"""

import argparse
import asyncio
import sys

from app.config import get_settings
from app.engine.case_loader import all_cases
from app.voice.clips import reply_clips, resolution_clip, static_clips
from app.voice.gnani_client import GnaniError, close_gnani
from app.voice.tts import get_tts, split_text


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--case", help="case id (default: all cases)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-replies", action="store_true", help="skip interrogation replies")
    args = ap.parse_args()

    cases = [c for c in all_cases() if not args.case or c.meta.id == args.case]
    if not cases:
        print(f"No case named {args.case!r}.")
        return 2

    tts = get_tts()
    if not args.dry_run and not tts.configured:
        print("GNANI_API_KEY is not set in backend/.env.")
        return 2

    made = skipped = requests = failed = 0
    total_seconds = 0.0
    for case in cases:
        print(f"\n{case.meta.id}: {case.meta.title}")
        clips = static_clips(case) + [resolution_clip(case)] + ([] if args.no_replies else reply_clips(case))
        for clip in clips:
            label = f"  {clip.id[:40]:<40} {clip.voice.voice:<8} {clip.voice.model:<12}"
            if tts.cached(clip.voice, clip.text):
                skipped += 1
                print(f"{label} cached")
                continue
            n = len(split_text(clip.text))
            if args.dry_run:
                requests += n
                print(f"{label} would generate ({len(clip.text)} chars, {n} request(s))")
                continue
            try:
                out = await tts.speak(clip.voice, clip.text)
            except GnaniError as e:
                failed += 1
                print(f"{label} FAILED: {e}")
                continue
            made += 1
            requests += out.requests
            total_seconds += out.seconds
            print(f"{label} {out.seconds:5.1f}s  {out.path.name[:12]}...")

    await close_gnani()
    verb = "would make" if args.dry_run else "made"
    print(f"\n{verb} {made if not args.dry_run else requests} | cached {skipped} | failed {failed} | "
          f"Gnani requests {requests} | new audio {total_seconds:.0f}s | cache {get_settings().audio_cache_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
