"""Tests for the voice profile pipeline.

The renderer is pure Python and gets exhaustive coverage. The analyzer is
LLM-backed; we mock the LLM and verify (a) the prompt instructs the model
to return JSON, (b) malformed responses raise ValueError instead of writing
garbage, (c) code-fence wrapping is tolerated.
"""

import json

import pytest
from unittest.mock import AsyncMock, patch

from pipeline.voice_profile import (
    ClosersProfile,
    LengthProfile,
    OpenersProfile,
    StructureProfile,
    ToneProfile,
    VoiceProfile,
    analyze_samples,
    render_system_prompt,
)


# ─── Renderer tests (pure Python, exhaustive) ────────────────────────────────


def _make_profile(**overrides) -> VoiceProfile:
    base = dict(
        samples_count=5,
        platform_mix={"linkedin": 5},
        length=LengthProfile(avg_words=140, p90_words=210, tends="medium"),
        structure=StructureProfile(
            uses_line_breaks=True,
            uses_bullets="occasional",
            uses_numbered_lists=False,
            paragraph_count_avg=4,
        ),
        tone=ToneProfile(
            tone_register="informal-professional",
            uses_first_person=True,
            personal_anecdotes="frequent",
            emoji_use="sparing",
            emoji_typical=["🚀", "👇"],
        ),
        openers=OpenersProfile(
            patterns=["personal story hook", "bold one-liner"],
            examples=["Last week, a customer told me X.", "I used to think Y."],
        ),
        closers=ClosersProfile(
            patterns=["question to audience", "call-to-action"],
            uses_hashtags="rarely",
        ),
        topics=["B2B SaaS", "founder lessons"],
        avoid=["corporate jargon", "leverage as a verb"],
    )
    base.update(overrides)
    return VoiceProfile(**base)


def test_render_includes_brand_name():
    profile = _make_profile()
    out = render_system_prompt(profile, brand_name="Acme Corp")
    assert "Acme Corp" in out


def test_render_short_vs_long_voice_differ():
    short = _make_profile(
        length=LengthProfile(avg_words=40, p90_words=70, tends="short")
    )
    long_ = _make_profile(
        length=LengthProfile(avg_words=280, p90_words=400, tends="long")
    )
    short_out = render_system_prompt(short, brand_name="A")
    long_out = render_system_prompt(long_, brand_name="A")
    assert short_out != long_out
    assert "short" in short_out.lower() or "40" in short_out
    assert "longer" in long_out.lower() or "280" in long_out


def test_render_distinguishes_register():
    casual = _make_profile(
        tone=ToneProfile(
            tone_register="casual",
            uses_first_person=True,
            personal_anecdotes="occasional",
            emoji_use="moderate",
            emoji_typical=[],
        )
    )
    academic = _make_profile(
        tone=ToneProfile(
            tone_register="academic",
            uses_first_person=False,
            personal_anecdotes="never",
            emoji_use="none",
            emoji_typical=[],
        )
    )
    casual_out = render_system_prompt(casual, brand_name="A")
    academic_out = render_system_prompt(academic, brand_name="A")
    assert "casual" in casual_out.lower()
    assert "academic" in academic_out.lower()
    assert "first person" in casual_out.lower()
    assert "avoid first-person" in academic_out.lower()


def test_render_includes_opener_examples_verbatim():
    profile = _make_profile(
        openers=OpenersProfile(
            patterns=["personal story hook"],
            examples=["I used to think hiring was a numbers game."],
        )
    )
    out = render_system_prompt(profile, brand_name="A")
    assert "I used to think hiring was a numbers game." in out


def test_render_handles_empty_optional_fields():
    profile = _make_profile(
        openers=OpenersProfile(patterns=[], examples=[]),
        topics=[],
        avoid=[],
    )
    out = render_system_prompt(profile, brand_name="A")
    assert "OPENINGS" not in out
    assert "Topics this author" not in out
    assert "Avoid these patterns" not in out


def test_render_includes_tone_tags_when_provided():
    profile = _make_profile()
    out = render_system_prompt(
        profile, brand_name="A", tone_tags=["punchy", "warm"]
    )
    assert "punchy" in out and "warm" in out


def test_render_omits_tone_tags_section_when_empty():
    profile = _make_profile()
    out = render_system_prompt(profile, brand_name="A", tone_tags=[])
    assert "User-tagged tone keywords" not in out


def test_render_hashtag_policy_changes_with_uses_hashtags():
    never = _make_profile(
        closers=ClosersProfile(patterns=[], uses_hashtags="never")
    )
    often = _make_profile(
        closers=ClosersProfile(patterns=[], uses_hashtags="often")
    )
    assert "Never use hashtags." in render_system_prompt(never, brand_name="A")
    assert "part of the voice" in render_system_prompt(often, brand_name="A")


def test_render_emoji_typical_appears_when_use_is_not_none():
    profile = _make_profile(
        tone=ToneProfile(
            tone_register="casual",
            uses_first_person=True,
            personal_anecdotes="occasional",
            emoji_use="moderate",
            emoji_typical=["🔥", "💡", "🚀"],
        )
    )
    out = render_system_prompt(profile, brand_name="A")
    assert "🔥" in out


def test_render_emoji_typical_omitted_when_emoji_use_is_none():
    profile = _make_profile(
        tone=ToneProfile(
            tone_register="formal-professional",
            uses_first_person=False,
            personal_anecdotes="never",
            emoji_use="none",
            emoji_typical=["🚀"],  # should be ignored
        )
    )
    out = render_system_prompt(profile, brand_name="A")
    assert "🚀" not in out
    assert "no emojis" in out.lower()


# ─── Analyzer tests (LLM mocked) ─────────────────────────────────────────────


_VALID_PROFILE_JSON = {
    "schema_version": 1,
    "samples_count": 3,
    "platform_mix": {"linkedin": 3},
    "length": {"avg_words": 150, "p90_words": 220, "tends": "medium"},
    "structure": {
        "uses_line_breaks": True,
        "uses_bullets": "occasional",
        "uses_numbered_lists": False,
        "paragraph_count_avg": 3,
    },
    "tone": {
        "register": "informal-professional",
        "uses_first_person": True,
        "personal_anecdotes": "frequent",
        "emoji_use": "sparing",
        "emoji_typical": ["🚀"],
    },
    "openers": {
        "patterns": ["personal story hook"],
        "examples": ["Last week..."],
    },
    "closers": {
        "patterns": ["question"],
        "uses_hashtags": "rarely",
    },
    "topics": ["B2B SaaS"],
    "avoid": ["jargon"],
}


@pytest.mark.asyncio
async def test_analyze_returns_validated_profile():
    with patch(
        "pipeline.voice_profile.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = json.dumps(_VALID_PROFILE_JSON)
        profile = await analyze_samples(["sample 1", "sample 2", "sample 3"])
        assert profile.samples_count == 3
        assert profile.length.tends == "medium"
        assert profile.tone.tone_register == "informal-professional"


@pytest.mark.asyncio
async def test_analyze_tolerates_code_fence_wrapping():
    fenced = "```json\n" + json.dumps(_VALID_PROFILE_JSON) + "\n```"
    with patch(
        "pipeline.voice_profile.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = fenced
        profile = await analyze_samples(["s1", "s2", "s3"])
        assert profile.tone.tone_register == "informal-professional"


@pytest.mark.asyncio
async def test_analyze_tolerates_leading_prose():
    raw = (
        "Here is the voice profile for the samples you provided:\n\n"
        + json.dumps(_VALID_PROFILE_JSON)
        + "\n\nLet me know if you need anything else."
    )
    with patch(
        "pipeline.voice_profile.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = raw
        profile = await analyze_samples(["s1"])
        assert profile.samples_count == 1


@pytest.mark.asyncio
async def test_analyze_raises_on_malformed_json():
    with patch(
        "pipeline.voice_profile.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = "this is definitely not json"
        with pytest.raises(ValueError, match="malformed JSON"):
            await analyze_samples(["s1"])


@pytest.mark.asyncio
async def test_analyze_raises_on_invalid_schema():
    bad = dict(_VALID_PROFILE_JSON)
    bad["tone"] = {**bad["tone"], "register": "INVALID-REGISTER"}
    with patch(
        "pipeline.voice_profile.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = json.dumps(bad)
        with pytest.raises(ValueError, match="failed validation"):
            await analyze_samples(["s1"])


@pytest.mark.asyncio
async def test_analyze_overrides_samples_count_with_actual_input_length():
    """If the LLM hallucinates samples_count, we trust what we actually sent."""
    payload = dict(_VALID_PROFILE_JSON)
    payload["samples_count"] = 999  # LLM hallucination
    with patch(
        "pipeline.voice_profile.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = json.dumps(payload)
        profile = await analyze_samples(["s1", "s2"])
        assert profile.samples_count == 2


@pytest.mark.asyncio
async def test_analyze_uses_provided_platform_mix():
    payload = dict(_VALID_PROFILE_JSON)
    payload["platform_mix"] = {"x": 10}  # LLM guess
    with patch(
        "pipeline.voice_profile.generate", new_callable=AsyncMock
    ) as mock_gen:
        mock_gen.return_value = json.dumps(payload)
        profile = await analyze_samples(
            ["s1", "s2"], platform_hints={"linkedin": 1, "x": 1}
        )
        assert profile.platform_mix == {"linkedin": 1, "x": 1}


@pytest.mark.asyncio
async def test_analyze_rejects_empty_samples():
    with pytest.raises(ValueError, match="at least one sample"):
        await analyze_samples([])


@pytest.mark.asyncio
async def test_analyze_caps_at_15_samples():
    """16th+ samples must not be sent to the LLM (token budget)."""
    payload = dict(_VALID_PROFILE_JSON)
    captured_message = {}

    async def capture(**kwargs):
        captured_message["msg"] = kwargs["user_message"]
        return json.dumps(payload)

    with patch("pipeline.voice_profile.generate", side_effect=capture):
        await analyze_samples([f"sample {i}" for i in range(20)])
        msg = captured_message["msg"]
        assert "Sample 15" in msg
        assert "Sample 16" not in msg
