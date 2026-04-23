import pytest
from unittest.mock import AsyncMock, patch


# ─── analyze tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_analyze_calls_llm_with_title_and_text():
    with patch("pipeline.analyze.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "• Point 1\n• Point 2"
        from pipeline.analyze import summarize
        result = await summarize("Article Title", "Long article body text here.")
        assert result == "• Point 1\n• Point 2"
        call_kwargs = mock_gen.call_args[1]
        assert "Article Title" in call_kwargs["user_message"]
        assert "Long article body text here." in call_kwargs["user_message"]


@pytest.mark.asyncio
async def test_analyze_truncates_long_text():
    long_text = "x" * 20000
    with patch("pipeline.analyze.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "summary"
        from pipeline.analyze import summarize
        await summarize("Title", long_text)
        call_kwargs = mock_gen.call_args[1]
        # user_message must not exceed ~12000 chars (8000 char text limit + overhead)
        assert len(call_kwargs["user_message"]) < 12000


@pytest.mark.asyncio
async def test_analyze_handles_empty_title():
    with patch("pipeline.analyze.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "summary"
        from pipeline.analyze import summarize
        result = await summarize("", "Some content")
        assert result == "summary"
        call_kwargs = mock_gen.call_args[1]
        assert "Some content" in call_kwargs["user_message"]
        assert "Title:" not in call_kwargs["user_message"]


# ─── generate tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_linkedin_variant():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Great LinkedIn post text here."
        from pipeline.generate import generate_variants
        variants = await generate_variants(
            summary="Key points about AI.",
            brand_system_prompt="Write posts in a professional tone.",
            platforms=["linkedin"],
        )
        assert len(variants) == 1
        assert variants[0]["platform"] == "linkedin"
        assert variants[0]["body"] == "Great LinkedIn post text here."
        call_kwargs = mock_gen.call_args[1]
        assert "linkedin" in call_kwargs["user_message"].lower()
        assert "Key points about AI." in call_kwargs["user_message"]


@pytest.mark.asyncio
async def test_generate_x_variant():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Short X post."
        from pipeline.generate import generate_variants
        variants = await generate_variants(
            summary="Key points.",
            brand_system_prompt="Be concise.",
            platforms=["x"],
        )
        assert len(variants) == 1
        assert variants[0]["platform"] == "x"
        call_kwargs = mock_gen.call_args[1]
        # The user_message should mention X/Twitter or 280 characters
        user_msg = call_kwargs["user_message"].lower()
        assert "280" in user_msg or "twitter" in user_msg or "x/" in user_msg


@pytest.mark.asyncio
async def test_generate_multiple_platforms_calls_llm_once_per_platform():
    call_count = 0

    async def fake_generate(**kwargs):
        nonlocal call_count
        call_count += 1
        return f"Post for {call_count}"

    with patch("pipeline.generate.generate", side_effect=fake_generate):
        from pipeline.generate import generate_variants
        variants = await generate_variants(
            summary="summary",
            brand_system_prompt="brand prompt",
            platforms=["linkedin", "x"],
        )
        assert len(variants) == 2
        assert call_count == 2
        platforms = {v["platform"] for v in variants}
        assert platforms == {"linkedin", "x"}
        assert variants[0]["body"] != variants[1]["body"]
