"""Tests for the regenerate pipeline.

LLM is mocked. We assert the user message is correctly assembled (instruction,
current body, optional summary, platform hint), and that the brand system
prompt is passed straight through.
"""

import pytest
from unittest.mock import AsyncMock, patch

from pipeline.regenerate import regenerate_variant


@pytest.mark.asyncio
async def test_regenerate_returns_stripped_body():
    with patch(
        "pipeline.regenerate.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = "  Revised post body.  \n"
        out = await regenerate_variant(
            platform="linkedin",
            current_body="Original post.",
            instruction="Make it shorter.",
            brand_system_prompt="Brand voice prompt.",
        )
        assert out == "Revised post body."


@pytest.mark.asyncio
async def test_regenerate_passes_brand_prompt_through_as_system():
    with patch(
        "pipeline.regenerate.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = "x"
        await regenerate_variant(
            platform="x",
            current_body="hello",
            instruction="punchier",
            brand_system_prompt="THE_BRAND_PROMPT",
        )
        kwargs = mock_gen.call_args[1]
        assert kwargs["system_prompt"] == "THE_BRAND_PROMPT"


@pytest.mark.asyncio
async def test_regenerate_user_message_includes_instruction_and_body():
    with patch(
        "pipeline.regenerate.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = "x"
        await regenerate_variant(
            platform="linkedin",
            current_body="ORIGINAL_DRAFT_TEXT",
            instruction="Add a question at the end.",
            brand_system_prompt="prompt",
        )
        msg = mock_gen.call_args[1]["user_message"]
        assert "ORIGINAL_DRAFT_TEXT" in msg
        assert "Add a question at the end." in msg
        assert "linkedin" in msg.lower() or "LinkedIn" in msg


@pytest.mark.asyncio
async def test_regenerate_includes_summary_when_provided():
    with patch(
        "pipeline.regenerate.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = "x"
        await regenerate_variant(
            platform="linkedin",
            current_body="body",
            instruction="add a stat",
            brand_system_prompt="prompt",
            summary="THE_SOURCE_SUMMARY",
        )
        msg = mock_gen.call_args[1]["user_message"]
        assert "THE_SOURCE_SUMMARY" in msg


@pytest.mark.asyncio
async def test_regenerate_omits_summary_block_when_absent():
    with patch(
        "pipeline.regenerate.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = "x"
        await regenerate_variant(
            platform="x",
            current_body="body",
            instruction="instr",
            brand_system_prompt="prompt",
        )
        msg = mock_gen.call_args[1]["user_message"]
        assert "ORIGINAL SOURCE SUMMARY" not in msg


@pytest.mark.asyncio
async def test_regenerate_warns_against_fabricating_facts_in_user_message():
    """The 'do NOT add facts that aren't here' guardrail must be present."""
    with patch(
        "pipeline.regenerate.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = "x"
        await regenerate_variant(
            platform="linkedin",
            current_body="body",
            instruction="add a stat about adoption",
            brand_system_prompt="prompt",
            summary="background context",
        )
        msg = mock_gen.call_args[1]["user_message"]
        assert "fabricating" in msg.lower() or "do not add facts" in msg.lower() \
            or "do NOT add facts" in msg
