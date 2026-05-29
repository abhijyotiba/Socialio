from pipeline.matrix import (
    FORMATS,
    ANGLES,
    IDEA_TYPES,
    cell_hash,
    expand_idea_to_cells,
)


def test_vocabularies_are_the_agreed_sets():
    assert set(FORMATS) == {
        "hot_take", "how_to", "personal_story", "question", "myth_buster", "thread",
    }
    assert set(ANGLES) == {"beginner", "expert", "contrarian", "practical"}
    assert set(IDEA_TYPES) == {"stat", "story", "claim", "framework", "lesson"}


def test_cell_hash_is_stable_and_order_independent_of_call():
    h1 = cell_hash("idea-1", "hot_take", "expert", "linkedin")
    h2 = cell_hash("idea-1", "hot_take", "expert", "linkedin")
    assert h1 == h2
    assert h1 != cell_hash("idea-1", "hot_take", "expert", "x")
    assert h1 != cell_hash("idea-1", "how_to", "expert", "linkedin")


def test_expand_uses_only_suitable_formats_and_angles():
    idea = {
        "id": "idea-1",
        "suitable_formats": ["hot_take", "thread"],
        "suitable_angles": ["expert"],
    }
    cells = expand_idea_to_cells(idea, platforms=["linkedin", "x"])
    combos = {(c["format"], c["angle"], c["platform"]) for c in cells}
    # 2 formats x 1 angle x 2 platforms = 4 cells
    assert len(cells) == 4
    assert ("hot_take", "expert", "linkedin") in combos
    assert ("thread", "expert", "x") in combos
    # Nothing outside the suitable sets:
    assert all(c["format"] in {"hot_take", "thread"} for c in cells)
    assert all(c["angle"] == "expert" for c in cells)


def test_expand_falls_back_to_all_vocab_when_suitable_lists_empty():
    idea = {"id": "idea-2", "suitable_formats": [], "suitable_angles": []}
    cells = expand_idea_to_cells(idea, platforms=["linkedin"])
    # 6 formats x 4 angles x 1 platform
    assert len(cells) == 24


def test_expand_ignores_unknown_format_or_angle_values():
    idea = {
        "id": "idea-3",
        "suitable_formats": ["hot_take", "not_a_format"],
        "suitable_angles": ["expert", "nonsense"],
    }
    cells = expand_idea_to_cells(idea, platforms=["linkedin"])
    assert len(cells) == 1  # only (hot_take, expert, linkedin) survives filtering
    assert cells[0]["format"] == "hot_take"
    assert cells[0]["angle"] == "expert"


def test_each_cell_carries_idea_id_and_hash():
    idea = {"id": "idea-9", "suitable_formats": ["how_to"], "suitable_angles": ["practical"]}
    cells = expand_idea_to_cells(idea, platforms=["x"])
    c = cells[0]
    assert c["idea_id"] == "idea-9"
    assert c["matrix_cell_hash"] == cell_hash("idea-9", "how_to", "practical", "x")
