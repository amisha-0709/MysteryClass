"""Validate every case (or the given case.json files).

Usage (from backend/):
    .venv\\Scripts\\python -m scripts.validate_case
    .venv\\Scripts\\python -m scripts.validate_case ..\\cases\\case_001\\case.json
"""

import json
import sys
from pathlib import Path

from pydantic import ValidationError

from app.config import get_settings
from app.engine.case_loader import CaseLoadError, read_case_file
from app.engine.validation import reachable_evidence, validate_case


def check(path: Path) -> bool:
    try:
        case = read_case_file(path)
    except (ValidationError, json.JSONDecodeError, CaseLoadError) as e:
        print(f"✗ {path}\n  schema error:\n{e}")
        return False
    errors = validate_case(case)
    if errors:
        print(f"✗ {path}")
        for err in errors:
            print(f"  - {err}")
        return False
    initial = sum(e.unlock.initial for e in case.evidence)
    replies = sum(len(t.replies) for s in case.suspects for t in s.topics)
    topics = sum(len(s.topics) for s in case.suspects)
    print(
        f"✓ {case.meta.id} · {case.meta.title}\n"
        f"  {len(case.suspects)} suspects · {len(case.evidence)} evidence ({initial} initial, "
        f"{len(reachable_evidence(case))} reachable) · {len(case.contradictions)} contradictions "
        f"({sum(c.decisive for c in case.contradictions)} decisive) · {len(case.timeline)} timeline events\n"
        f"  dialogue: {topics} topics · {replies} authored replies"
    )
    return True


def main(argv: list[str]) -> int:
    paths = [Path(a) for a in argv] or sorted(get_settings().cases_dir.glob("*/case.json"))
    if not paths:
        print("No case files found.")
        return 1
    return 0 if all([check(p) for p in paths]) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    sys.exit(main(sys.argv[1:]))
