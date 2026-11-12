RANKS: list[tuple[int, str]] = [
    (0, "Rookie"),
    (200, "Junior Detective"),
    (500, "Detective"),
    (1000, "Senior Detective"),
    (2000, "Inspector"),
    (3500, "Chief Inspector"),
]


def rank_for(xp: int) -> dict:
    """Current rank plus progress toward the next one."""
    current = RANKS[0]
    nxt: tuple[int, str] | None = None
    for i, (threshold, name) in enumerate(RANKS):
        if xp >= threshold:
            current = (threshold, name)
            nxt = RANKS[i + 1] if i + 1 < len(RANKS) else None
    return {
        "name": current[1],
        "xp_floor": current[0],
        "next_name": nxt[1] if nxt else None,
        "next_xp": nxt[0] if nxt else None,
    }
