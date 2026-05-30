import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_groq_adapter_returns_text():
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "Generated text"

    with patch("adapters.groq.AsyncGroq") as MockClient:
        instance = MockClient.return_value
        instance.chat = MagicMock()
        instance.chat.completions = MagicMock()
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        from adapters.groq import groq_generate
        result = await groq_generate("system prompt", "user message")
        assert result == "Generated text"
        instance.chat.completions.create.assert_called_once()
        call_kwargs = instance.chat.completions.create.call_args[1]
        assert call_kwargs["messages"][0]["role"] == "system"
        assert call_kwargs["messages"][0]["content"] == "system prompt"
        assert call_kwargs["messages"][1]["role"] == "user"
        assert call_kwargs["messages"][1]["content"] == "user message"
        # Default token budget unless overridden.
        assert call_kwargs["max_tokens"] == 1024


@pytest.mark.asyncio
async def test_groq_adapter_honors_custom_max_tokens():
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "x"

    with patch("adapters.groq.AsyncGroq") as MockClient:
        instance = MockClient.return_value
        instance.chat = MagicMock()
        instance.chat.completions = MagicMock()
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        from adapters.groq import groq_generate
        await groq_generate("system prompt", "user message", max_tokens=8000)
        call_kwargs = instance.chat.completions.create.call_args[1]
        assert call_kwargs["max_tokens"] == 8000


@pytest.mark.asyncio
async def test_gemini_adapter_returns_text():
    mock_response = MagicMock()
    mock_response.text = "Gemini generated text"

    with patch("adapters.gemini.genai") as mock_genai:
        client_mock = MagicMock()
        mock_genai.Client.return_value = client_mock
        client_mock.aio.models.generate_content = AsyncMock(return_value=mock_response)

        from adapters.gemini import gemini_generate
        result = await gemini_generate("system prompt", "user message")
        assert result == "Gemini generated text"


@pytest.mark.asyncio
async def test_llm_uses_groq_primary():
    with patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq:
        mock_groq.return_value = "Groq result"

        from adapters.llm import generate
        result = await generate("sys", "user")
        assert result == "Groq result"
        # Default token budget is forwarded.
        mock_groq.assert_called_once_with("sys", "user", max_tokens=1024)


@pytest.mark.asyncio
async def test_llm_forwards_custom_max_tokens_to_both_adapters():
    with (
        patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq,
        patch("adapters.llm.gemini_generate", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_groq.side_effect = Exception("Groq down")
        mock_gemini.return_value = "ok"

        from adapters.llm import generate
        await generate("sys", "user", max_tokens=8000)
        assert mock_groq.call_args.kwargs["max_tokens"] == 8000
        assert mock_gemini.call_args.kwargs["max_tokens"] == 8000


@pytest.mark.asyncio
async def test_llm_falls_back_to_gemini_when_groq_fails():
    with (
        patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq,
        patch("adapters.llm.gemini_generate", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_groq.side_effect = Exception("Groq rate limit")
        mock_gemini.return_value = "Gemini fallback result"

        from adapters.llm import generate
        result = await generate("sys", "user")
        assert result == "Gemini fallback result"
        mock_gemini.assert_called_once_with("sys", "user", max_tokens=1024)


@pytest.mark.asyncio
async def test_llm_raises_if_both_fail():
    with (
        patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq,
        patch("adapters.llm.gemini_generate", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_groq.side_effect = Exception("Groq down")
        mock_gemini.side_effect = Exception("Gemini down")

        from adapters.llm import generate
        with pytest.raises(Exception, match="fallback AI models failed"):
            await generate("sys", "user")
        mock_groq.assert_called_once()
        mock_gemini.assert_called_once()
