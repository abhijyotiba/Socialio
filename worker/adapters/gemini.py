from google import genai
from google.genai import types

from adapters._types import GenerateResult
from config import get_settings


async def gemini_generate(
    system_prompt: str, user_message: str, max_tokens: int = 1024
) -> GenerateResult:
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    response = await client.aio.models.generate_content(
        model=settings.gemini_model,
        contents=user_message,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=max_tokens,
            http_options=types.HttpOptions(timeout=30000),
        ),
    )
    usage = response.usage_metadata
    return GenerateResult(
        body=response.text or "",
        prompt_tokens=usage.prompt_token_count if usage else 0,
        output_tokens=usage.candidates_token_count if usage else 0,
    )
