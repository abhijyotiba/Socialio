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


@pytest.mark.asyncio
async def test_gemini_adapter_returns_text():
    mock_response = MagicMock()
    mock_response.text = "Gemini generated text"

    with patch("adapters.gemini.genai") as mock_genai:
        mock_model = MagicMock()
        mock_genai.GenerativeModel.return_value = mock_model
        mock_model.generate_content_async = AsyncMock(return_value=mock_response)

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
        mock_groq.assert_called_once_with("sys", "user")


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
        mock_gemini.assert_called_once_with("sys", "user")


@pytest.mark.asyncio
async def test_llm_raises_if_both_fail():
    with (
        patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq,
        patch("adapters.llm.gemini_generate", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_groq.side_effect = Exception("Groq down")
        mock_gemini.side_effect = Exception("Gemini down")

        from adapters.llm import generate
        with pytest.raises(Exception, match="Gemini down"):
            await generate("sys", "user")
