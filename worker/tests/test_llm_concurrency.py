import asyncio
import pytest
from unittest.mock import patch


@pytest.mark.asyncio
async def test_generate_caps_in_flight_calls_at_the_limit():
    """With the limiter set to 2, no more than 2 underlying provider calls run
    concurrently even when 5 generate() coroutines are launched at once."""
    import adapters.llm as llm

    in_flight = 0
    peak = 0

    async def fake_groq(system_prompt, user_message, **_kwargs):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.02)  # hold the slot so overlap is observable
        in_flight -= 1
        return "ok"

    # Force a known small limit for the test, independent of env config.
    with patch.object(llm, "_LLM_SEMAPHORE", asyncio.Semaphore(2)), \
         patch("adapters.llm.groq_generate", side_effect=fake_groq):
        results = await asyncio.gather(
            *(llm.generate(system_prompt="s", user_message="m") for _ in range(5))
        )

    assert results == ["ok"] * 5
    assert peak <= 2  # the limiter held the line


@pytest.mark.asyncio
async def test_generate_still_falls_back_to_gemini_under_the_limiter():
    """The semaphore must not change the Groq→Gemini fallback contract."""
    import adapters.llm as llm

    async def boom(system_prompt, user_message, **_kwargs):
        raise RuntimeError("groq down")

    async def ok_gemini(system_prompt, user_message, **_kwargs):
        return "from gemini"

    with patch.object(llm, "_LLM_SEMAPHORE", asyncio.Semaphore(2)), \
         patch("adapters.llm.groq_generate", side_effect=boom), \
         patch("adapters.llm.gemini_generate", side_effect=ok_gemini):
        out = await llm.generate(system_prompt="s", user_message="m")

    assert out == "from gemini"
