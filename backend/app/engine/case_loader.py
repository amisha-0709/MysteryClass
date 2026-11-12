import json
from functools import lru_cache
from pathlib import Path

from ..config import get_settings
from ..schemas.case import CaseDefinition
from .validation import validate_case


class CaseLoadError(RuntimeError):
    pass


class CaseNotFound(KeyError):
    pass


def _merge_dialogue(data: dict, dialogue_path: Path) -> None:
    """dialogue.json holds each suspect's interrogation script: {"suspects": {id: {lines, topics}}}."""
    if not dialogue_path.is_file():
        return
    script = json.loads(dialogue_path.read_text(encoding="utf-8")).get("suspects", {})
    known = {s["id"] for s in data.get("suspects", [])}
    unknown = set(script) - known
    if unknown:
        raise CaseLoadError(f"{dialogue_path}: unknown suspects {sorted(unknown)}")
    for s in data.get("suspects", []):
        part = script.get(s["id"], {})
        if "topics" in part:
            s["topics"] = part["topics"]
        if "lines" in part:
            s["lines"] = part["lines"]


def read_case_file(path: Path) -> CaseDefinition:
    """Parse case.json plus its dialogue.json (schema-checked, not yet consistency-checked)."""
    data = json.loads(path.read_text(encoding="utf-8"))
    _merge_dialogue(data, path.with_name("dialogue.json"))
    return CaseDefinition.model_validate(data)


def load_case_file(path: Path) -> CaseDefinition:
    case = read_case_file(path)
    errors = validate_case(case)
    if errors:
        raise CaseLoadError(f"{path}: " + "; ".join(errors))
    return case


@lru_cache
def _load_all(cases_dir: str) -> dict[str, CaseDefinition]:
    cases: dict[str, CaseDefinition] = {}
    for path in sorted(Path(cases_dir).glob("*/case.json")):
        case = load_case_file(path)
        if case.meta.id in cases:
            raise CaseLoadError(f"duplicate case id {case.meta.id}")
        cases[case.meta.id] = case
    return cases


def all_cases() -> list[CaseDefinition]:
    return sorted(_load_all(str(get_settings().cases_dir)).values(), key=lambda c: c.meta.order)


def get_case(case_id: str) -> CaseDefinition:
    try:
        return _load_all(str(get_settings().cases_dir))[case_id]
    except KeyError:
        raise CaseNotFound(case_id) from None
