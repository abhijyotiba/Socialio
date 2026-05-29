"""The atomization matrix — pure, deterministic cell expansion.

Given an idea (with its LLM-tagged suitable formats/angles) and the target
platforms, produce the set of (idea × format × angle × platform) cells. Each
cell carries a stable hash used as the dedup key in content_items.
"""

import hashlib

FORMATS = ("hot_take", "how_to", "personal_story", "question", "myth_buster", "thread")
ANGLES = ("beginner", "expert", "contrarian", "practical")
IDEA_TYPES = ("stat", "story", "claim", "framework", "lesson")


def cell_hash(idea_id: str, fmt: str, angle: str, platform: str) -> str:
    raw = f"{idea_id}|{fmt}|{angle}|{platform}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def expand_idea_to_cells(idea: dict, platforms: list[str]) -> list[dict]:
    """Cross one idea with its suitable formats/angles and the platforms.

    Empty suitable lists fall back to the full vocabulary (the LLM gave us no
    guidance, so allow everything). Unknown values are filtered out so a
    hallucinated format never reaches the DB CHECK constraint.
    """
    formats = [f for f in (idea.get("suitable_formats") or []) if f in FORMATS] or list(FORMATS)
    angles = [a for a in (idea.get("suitable_angles") or []) if a in ANGLES] or list(ANGLES)

    cells: list[dict] = []
    for platform in platforms:
        for fmt in formats:
            for angle in angles:
                cells.append(
                    {
                        "idea_id": idea["id"],
                        "format": fmt,
                        "angle": angle,
                        "platform": platform,
                        "matrix_cell_hash": cell_hash(idea["id"], fmt, angle, platform),
                    }
                )
    return cells
