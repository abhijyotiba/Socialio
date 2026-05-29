import json
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_extract_ideas_parses_llm_json_array():
    fake = json.dumps([
        {
            "essence": "Most onboarding flows lose users at step 3.",
            "idea_type": "stat",
            "source_quote": "40% of users drop off at the third onboarding step.",
            "strength": 4,
            "suitable_formats": ["stat_callout", "myth_buster", "hot_take"],
            "suitable_angles": ["expert", "practical"],
        }
    ])
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = fake
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas(
            title="Onboarding Report",
            text="40% of users drop off at the third onboarding step. ...",
            brand_system_prompt="Professional tone.",
        )
    assert len(ideas) == 1
    idea = ideas[0]
    assert idea["essence"].startswith("Most onboarding")
    assert idea["idea_type"] == "stat"
    assert idea["source_quote"]
    assert idea["strength"] == 4
    # Unknown format ("stat_callout") is dropped; valid ones kept.
    assert "stat_callout" not in idea["suitable_formats"]
    assert "myth_buster" in idea["suitable_formats"]
    assert idea["suitable_angles"] == ["expert", "practical"]


@pytest.mark.asyncio
async def test_extract_ideas_tolerates_json_wrapped_in_markdown_fence():
    fenced = "```json\n" + json.dumps([
        {"essence": "x", "idea_type": "claim", "source_quote": "q",
         "strength": 3, "suitable_formats": ["how_to"], "suitable_angles": ["beginner"]}
    ]) + "\n```"
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = fenced
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas("T", "body", "brand")
    assert len(ideas) == 1
    assert ideas[0]["idea_type"] == "claim"


@pytest.mark.asyncio
async def test_extract_ideas_drops_malformed_entries():
    bad = json.dumps([
        {"essence": "good", "idea_type": "lesson", "source_quote": "q",
         "strength": 5, "suitable_formats": ["thread"], "suitable_angles": ["expert"]},
        {"essence": "", "idea_type": "lesson", "source_quote": "q"},          # empty essence
        {"idea_type": "not_a_type", "essence": "e", "source_quote": "q"},     # bad type
        {"essence": "no quote", "idea_type": "claim", "source_quote": ""},    # empty quote
    ])
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = bad
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas("T", "body", "brand")
    assert len(ideas) == 1
    assert ideas[0]["essence"] == "good"


@pytest.mark.asyncio
async def test_extract_ideas_returns_empty_on_unparseable_output():
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "I could not find any ideas, sorry!"
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas("T", "body", "brand")
    assert ideas == []


@pytest.mark.asyncio
async def test_extract_ideas_truncates_very_long_text():
    long_text = "x" * 50000
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "[]"
        from pipeline.atomize import extract_ideas
        await extract_ideas("T", long_text, "brand")
        sent = mock_gen.call_args[1]["user_message"]
    assert len(sent) < 16000  # text cap + prompt overhead


@pytest.mark.asyncio
async def test_extract_ideas_empty_text_skips_llm():
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas("T", "   ", "brand")
    assert ideas == []
    mock_gen.assert_not_called()
