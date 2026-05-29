import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_render_cell_includes_idea_format_angle_and_grounding():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "  A punchy contrarian LinkedIn post.  "
        from pipeline.generate import render_cell
        body = await render_cell(
            essence="Onboarding loses users at step 3.",
            source_quote="40% drop off at the third step.",
            fmt="hot_take",
            angle="contrarian",
            platform="linkedin",
            brand_system_prompt="Professional tone.",
        )
    assert body == "A punchy contrarian LinkedIn post."  # trimmed
    msg = mock_gen.call_args[1]["user_message"].lower()
    assert "onboarding loses users" in msg
    assert "40% drop off" in msg            # grounding quote present
    assert "hot_take" in msg or "hot take" in msg
    assert "contrarian" in msg
    assert "linkedin" in msg
    # brand prompt is the system prompt, not the user message
    assert mock_gen.call_args[1]["system_prompt"] == "Professional tone."


@pytest.mark.asyncio
async def test_render_cell_x_mentions_platform_constraint():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Short."
        from pipeline.generate import render_cell
        await render_cell(
            essence="e", source_quote="q", fmt="thread", angle="expert",
            platform="x", brand_system_prompt="brand",
        )
        msg = mock_gen.call_args[1]["user_message"].lower()
    assert "280" in msg or "twitter" in msg or "x/" in msg


@pytest.mark.asyncio
async def test_render_cell_requires_essence():
    from pipeline.generate import render_cell
    with pytest.raises(ValueError):
        await render_cell(
            essence="  ", source_quote="q", fmt="how_to", angle="beginner",
            platform="linkedin", brand_system_prompt="brand",
        )
